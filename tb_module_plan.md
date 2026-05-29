# Модуль управления туберкулезом — мастер-план разработки

> Документ-спецификация для разработки с Claude Code.
> Все архитектурные решения зафиксированы. Открытых вопросов нет.

---

## 1. Контекст

**Пользователь:** семейный врач в Украине + медсестра/медрегистратор. Две локации (Білогірʼя, Залужжя). Сейчас управляют ТБ-документами в наборе xlsx-файлов с дублированием данных, ручным ведением 14 листов «Групи Ризику», 2 листами «Виявлені/Контактні», большим реестром флюорографий (~1100 пациентов на локацию) и отдельной папкой наказов МОЗ.

**Проблема:** один пациент живёт в нескольких таблицах, обновление требует синхронизации трёх мест, нет напоминаний о просроченной флюоро, опросники додаток 9 — бумажные.

**Цель v1:** один источник правды, авто-генерируемые группы риска, дашборд просрочек, цифровой опросник, интеграция с уже существующим Chrome-расширением `Experimental12021237` (которое умеет парсить страницу пациента в medics.ua и определять факторы риска по ICPC-2/МКХ-10).

---

## 2. Архитектура

| Слой | Решение |
|------|---------|
| Frontend | React 18 + Vite + TypeScript + TailwindCSS + shadcn/ui |
| Routing | React Router v6 |
| State / fetching | TanStack Query |
| Forms | react-hook-form + zod |
| Tables | TanStack Table |
| Hosting frontend | Vercel (free tier) |
| Backend / DB | Supabase free tier (PostgreSQL + REST + Realtime) |
| Auth | Single PIN + JWT cookie через Vercel Edge Functions |
| Storage (сканы, наказы) | Supabase Storage |
| Email-дайджесты | Resend (free tier 3000/мес) |
| Excel-экспорт | библиотека `xlsx` (SheetJS) на клиенте |

**Auth-механика:**
- Один PIN на всю практику, хранится как bcrypt-хеш в env-переменной Vercel
- Vercel Edge Function `/api/auth` принимает PIN, проверяет хеш, выдаёт подписанный JWT (HS256, секрет в env)
- JWT в HttpOnly + Secure + SameSite=Lax cookie, срок 30 дней
- Все API-роуты middleware-проверяют JWT
- Brute-force: 5 неверных подряд с одного IP → блок на 15 минут (через Upstash Redis free tier или Vercel KV)

---

## 3. Модель данных (PostgreSQL DDL)

```sql
-- ── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── ENUMS ───────────────────────────────────────────────────────────────────
create type tb_status as enum ('risk', 'detected', 'contact', 'cleared', 'external', 'archived');
create type fluoro_result_code as enum ('normal', 'pathology', 'pending', 'refused', 'unknown');
create type sputum_test_type as enum ('xpert', 'microscopy', 'culture', 'pcr');
create type questionnaire_result as enum ('low_risk', 'needs_xray', 'needs_referral');
create type data_source as enum ('manual', 'extension', 'imported_xlsx', 'mis_sync');

-- ── LOCATIONS ───────────────────────────────────────────────────────────────
create table locations (
  id   text primary key,           -- 'bilohirska', 'zaluzhe'
  name text not null
);
insert into locations (id, name) values
  ('bilohirska', 'Білогірська амбулаторія'),
  ('zaluzhe',    'Залужжя');

-- ── PATIENTS ────────────────────────────────────────────────────────────────
create table patients (
  id                    uuid primary key default uuid_generate_v4(),
  medics_id             text unique,                -- nullable для контактних не-декларантів
  surname               text not null,
  first_name            text not null,
  patronymic            text,
  birth_date            date not null,
  gender                char(1) check (gender in ('M','F')),
  phone                 text,
  address               text,
  location_id           text references locations(id) on delete set null,

  tb_status             tb_status not null default 'risk',
  contact_of            uuid references patients(id) on delete set null,

  medical_risk_groups   text[] not null default '{}',  -- ['hiv','oncology','diabetes',...]
  social_risk_groups    text[] not null default '{}',  -- ['displaced','medical_worker',...]

  diagnoses_codes       text[] not null default '{}',  -- кеш ICPC-2/МКХ-10 з МІС, для аудиту
  diagnoses_synced_at   timestamptz,                   -- коли востаннє оновили з МІС

  notes                 text,
  archived              boolean not null default false,
  archived_reason       text,                          -- 'left_practice','deceased','duplicate'
  archived_at           timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index patients_search        on patients (lower(surname), birth_date);
create index patients_medics        on patients (medics_id) where medics_id is not null;
create index patients_active        on patients (tb_status) where archived = false;
create index patients_location      on patients (location_id) where archived = false;
create index patients_med_groups    on patients using gin (medical_risk_groups);
create index patients_soc_groups    on patients using gin (social_risk_groups);
create index patients_contact_of    on patients (contact_of) where contact_of is not null;

-- ── FLUOROGRAPHY ────────────────────────────────────────────────────────────
create table fluorography (
  id                  uuid primary key default uuid_generate_v4(),
  patient_id          uuid not null references patients(id) on delete cascade,
  date                date not null,
  result              text,
  result_code         fluoro_result_code not null default 'unknown',
  next_planned_date   date,
  source              data_source not null default 'manual',
  notes               text,
  created_at          timestamptz not null default now()
);

create index fluoro_patient on fluorography (patient_id, date desc);
create index fluoro_planned on fluorography (next_planned_date) where next_planned_date is not null;

-- ── SPUTUM TESTS ────────────────────────────────────────────────────────────
create table sputum_tests (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid not null references patients(id) on delete cascade,
  date        date not null,
  result      text,
  test_type   sputum_test_type not null default 'xpert',
  notes       text,
  created_at  timestamptz not null default now()
);
create index sputum_patient on sputum_tests (patient_id, date desc);

-- ── QUESTIONNAIRES (додаток 9) ──────────────────────────────────────────────
create table questionnaires (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid references patients(id) on delete set null,  -- null = анонім
  filled_at   timestamptz not null default now(),
  answers     jsonb not null,                         -- {cough,weight_loss,night_sweats,fever,...}
  result      questionnaire_result not null,
  filled_by   text,                                   -- 'doctor'/'nurse'/'self'
  notes       text
);
create index questionnaires_patient on questionnaires (patient_id);
create index questionnaires_result  on questionnaires (result, filled_at desc);

-- ── MIS SYNC HISTORY ────────────────────────────────────────────────────────
create table mis_imports (
  id                   uuid primary key default uuid_generate_v4(),
  imported_at          timestamptz not null default now(),
  imported_by          text,
  filename             text,
  total_in_file        int,
  patients_added       int,
  patients_updated     int,
  patients_archived    int,
  diff_summary         jsonb
);

-- ── AUDIT LOG ───────────────────────────────────────────────────────────────
create table audit_log (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid references patients(id) on delete set null,
  action      text not null,
  changes     jsonb,
  user_label  text,
  created_at  timestamptz not null default now()
);
create index audit_patient on audit_log (patient_id, created_at desc);

-- ── ATTACHMENTS ─────────────────────────────────────────────────────────────
create table attachments (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid references patients(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  mime_type    text,
  size_bytes   int,
  category     text,                                  -- 'fluoro','sputum','questionnaire','other'
  created_at   timestamptz not null default now()
);
create index attachments_patient on attachments (patient_id);

-- ── TRIGGER: updated_at ──────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger patients_updated_at before update on patients
  for each row execute function set_updated_at();
```

---

## 4. UX и навигация

### Сайдбар (всегда виден на десктопе, drawer на мобиле)

| Раздел | Что внутри |
|--------|------------|
| 🏠 **Дашборд** | Виджеты «Просрочено», «На цьому тижні», «30 днів», статистика |
| 👥 **Пацієнти** | Таблица всех + фильтры + экспорт + кнопка «Додати» |
| 📋 **Опросники** | Список заполненных + кнопка «Новий опросник» |
| 📚 **Накази** | Библиотека PDF/DOCX (хранится в Supabase Storage) |
| ⚙️ **Налаштування** | Імпорт декларантів, email для дайджестов, смена PIN, журнал аудиту |

### Главный экран — таблица пациентов

Колонки: ПІБ • ДН • Вік • Локація • Статус • Групи ризику (chips) • Остання флюоро • Наступна флюоро • Дії

**Фильтры (combinable):**
- Локация: всі / Білогірʼя / Залужжя
- Статус: всі / на ризику / виявлені / контактні / зняті з обліку / архівні
- Групи ризику: мульти-чекбокс (medical отдельно от social)
- Флюоро: всі / просрочено / на цьому тижні / 30 днів / актуально
- Пошук по ПІБ або Medics ID

**Цветовая кодировка строк:**
- Красная полоска слева — флюоро просрочена
- Оранжевая — следующие 30 дней
- Жёлтая рамка — `tb_status='detected'`
- Синяя — `tb_status='contact'`

**Експорт:** кнопка «Експортувати XLSX» учитывает текущие фильтры. Файл `pacienti_<filter>_<YYYY-MM-DD>.xlsx`.

### Карточка пациента (drawer/page с табами)

- **Огляд** — поля + чекбоксы social risk groups + список medical risk groups (read-only из диагнозов)
- **Флюоро** — таблица истории + «+ Додати»
- **Мокротиння** — таблица истории + «+ Додати»
- **Опросники** — все опросники этого пациента
- **Файли** — вложения (R-снимки, сканы)
- **Аудит** — кто что когда менял

---

## 5. Сквозные требования

### Экспорт
Каждая таблица с фильтрами имеет кнопку «Експортувати в XLSX». В файл попадают **только записи в текущих фильтрах**. Структура колонок повторяет UI. Реализуется на клиенте через библиотеку `xlsx` — без серверной нагрузки.

### Аудит
Любое изменение в `patients`, `fluorography`, `sputum_tests`, `questionnaires` пишет запись в `audit_log` с дельтой полей (`changes` jsonb). Реализуется через триггеры PostgreSQL.

### Realtime
Если врач и медсестра одновременно работают, изменения видны без F5 — Supabase Realtime подписка на `patients`.

### Адаптивность
Desktop-first, но все экраны должны работать на 375px+ (телефон).

### Локализация
Весь UI — украинский. Месяца, форматы дат — `uk-UA`. Дайджесты — украинский.

### Error handling
Глобальный error boundary + toast-нотификации. API-ошибки логируются в Sentry (опц., free tier).

---

## 6. Реактуализация декларантов

**Триггер:** ежемесячно медсестра/врач выгружает свежий xlsx из МИС и загружает на странице «Налаштування → Імпорт декларантів».

**Алгоритм:**
1. Парсим xlsx (ожидаемые колонки: Medics ID, Прізвище, Імʼя, По батькові, Стать, Телефон, ДН, Адреса, Локація)
2. Сравниваем с текущей `patients` по `medics_id`:
   - **Новый Medics ID** → создаём пациента, `tb_status='risk'`, `source='mis_sync'`
   - **Существующий, изменились данные** (телефон, адрес) → обновляем, пишем в audit
   - **В базе есть, в xlsx нет** → автоматически `archived=true`, `archived_reason='left_practice'`. ТБ-история сохраняется.
3. Показываем превью diff: «Додано: X. Оновлено: Y. Архівовано: Z». Пользователь подтверждает.
4. После apply — запись в `mis_imports` с полным diff_summary.

**Напоминание:** на дашборде виджет «Останній імпорт декларантів: N днів тому» — становится оранжевым после 35 дней.

---

## 7. Дорожная карта

### Фаза 0 — фундамент

- [ ] Создать Supabase проект, применить SQL из раздела 3
- [ ] Создать GitHub репо, инициализировать Vite + React + TS + Tailwind + shadcn/ui
- [ ] Настроить Vercel deploy + env переменные (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `PIN_HASH`)
- [ ] Реализовать `/api/auth` Edge Function (PIN check + JWT issue)
- [ ] Реализовать middleware для защищённых роутов
- [ ] Сверстать сайдбар + 5 пустых страниц + login screen с PIN-padом
- [ ] Базовая обвязка TanStack Query + Supabase client

**DoD:** разворачиваюсь на vercel.app, ввожу PIN, попадаю на пустой дашборд, вижу боковое меню.

### Фаза 1 — единая база (приоритет №1)

- [ ] Страница «Налаштування → Імпорт декларантів»: drag-and-drop xlsx
- [ ] Парсер xlsx → нормализация → diff с БД → preview → apply
- [ ] Страница «Пацієнти»: TanStack Table + все фильтры из раздела 4
- [ ] Поиск с debounce (по surname, first_name, medics_id)
- [ ] Карточка пациента: табы Огляд / Флюоро / Мокротиння / Файли / Аудит
- [ ] CRUD на `fluorography` и `sputum_tests` через карточку
- [ ] Чекбоксы `social_risk_groups` редактируются прямо в карточке
- [ ] Экспорт текущего среза в xlsx
- [ ] Скрипт миграции исторических данных из старых xlsx (мэтчинг по ПІБ+ДН с master-списком)

**DoD:** загружен полный список декларантов, перенесены все данные из 5 xlsx, можно отфильтровать «Залужжя + ЦД + просрочено» и выгрузить в Excel.

### Фаза 2 — дашборд (приоритет №2)

- [ ] Виджет «Просрочено» (счётчик + клик → таблица)
- [ ] Виджет «На цьому тижні» (next_planned_date в [today, today+7])
- [ ] Виджет «Найближчі 30 днів»
- [ ] Виджет «Виявлені» (счётчик + быстрый переход)
- [ ] Виджет «Контактні без флюоро»
- [ ] Виджет «Останній імпорт декларантів N днів тому»
- [ ] Email-дайджест по понедельникам (Resend → оба email-а): топ-10 просроченных + summary
- [ ] Cron триггер для дайджеста (Vercel Cron Jobs)

**DoD:** в понедельник на email падает «У вас 23 пацієнта з просроченою флюоро, найгарячіший — Іваненко (просрочено 4 місяці)».

### Фаза 3 — опросник додаток 9 (приоритет №3)

- [ ] Форма опросника: 4 ВОЗ-симптома (кашель >2 тиж / нічна пітливість / схуднення / лихоманка) + дата контакта с ТБ + лет з останнього R-ОГК
- [ ] Логика результата: ≥1 симптом OR контакт <12 міс OR R-ОГК >12 міс → `needs_xray`; усі симптоми + позитивний скрин-тест → `needs_referral`; иначе `low_risk`
- [ ] При `needs_xray`/`needs_referral` — кнопка «Створити направлення» (генерирует PDF на основе шаблона `Направлення на мокротиння нове.docx`)
- [ ] Привязка к пациенту OR анонимно (галочка)
- [ ] Список заполненных опросников + фильтры

**DoD:** медсестра заполняет опросник за 30 секунд, при `needs_xray` сразу получает готовое направление PDF, опросник привязан к карточке пациента.

### Фаза 4 — порядок и интеграция (приоритет №4)

- [ ] Страница «Накази»: список из 13 файлов (загружены в Supabase Storage), просмотрщик PDF/DOCX
- [ ] Расширение `Experimental12021237` → новый файл `tb-module-bridge.js`
- [ ] На странице пациента в medics.ua появляется блок «📋 Модуль ТБ»:
  - Если пациент существует в модуле — показывает статус, последнюю флюоро, дату следующей
  - Кнопка «Оновити в модулі» — POST в Supabase REST API с актуальными данными
  - Если не существует — кнопка «Додати в модуль ТБ»
- [ ] Endpoint в Supabase, принимает POST от расширения и обновляет/создаёт пациента
- [ ] Auth для расширения: тот же PIN, хранится в chrome.storage, передаётся как Bearer token

**DoD:** открыл пациента в medics.ua → плашка «Модуль ТБ: ризик ЦД, флюоро 2024-04-02 (просрочено 6 міс)» → клик «Оновити» → новые данные в модуле.

---

## 8. Интеграция с расширением

**Шина данных:** расширение пишет напрямую в Supabase REST API (PostgREST) с Bearer-токеном, который пользователь однажды настраивает в опциях расширения (тот же PIN).

**Mapping ICPC-2/МКХ-10 → medical_risk_groups** (стартовый draft, перед Фазой 4 уточнить по наказу 102):

| Group key | Имя | ICPC-2 | МКХ-10 |
|-----------|-----|--------|--------|
| `hiv` | ВІЛ | B90 | B20-B24 |
| `oncology` | Онкологія | A79, B72, B74, D74-D77, R84, R85, U75-U77 | C00-C97, D00-D09, D45-D47 |
| `diabetes` | Цукровий діабет | T89, T90 | E10-E14 |
| `previously_treated` | Раніше лікувались | (отдельная отметка вручную или флаг) | A15-A19 в анамнезе (Z86.1) |
| `chronic_respiratory` | Хронічні респіраторні | R95, R96 | J40-J47 |
| `pneumonia_history` | Пневмонія в анамнезі | R81 | J12-J18 в анамнезі |
| `peptic_ulcer` | Виразкова хвороба | D85, D86 | K25-K28 |
| `psychiatric` | Психіатрія | P-коды | F-коды |
| `close_contact` | Близький контакт | через `contact_of` | через `contact_of` |

**Source of truth:** `src/lib/risk-groups-mapping.ts` — единая таблица, импортируется и в модуль, и в расширение.

---

## 9. Структура репозитория

```
tb-module/
├── README.md
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.example
├── supabase/
│   ├── migrations/
│   │   └── 0001_initial.sql       (раздел 3 целиком)
│   └── seed.sql                   (тестовые данные для локальной разработки)
├── api/                           (Vercel Edge Functions)
│   ├── auth.ts                    (PIN check + JWT)
│   ├── digest-cron.ts             (еженедельный email)
│   └── extension-sync.ts          (endpoint для chrome extension)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   │   ├── login.tsx
│   │   ├── dashboard.tsx
│   │   ├── patients/
│   │   │   ├── index.tsx          (таблица)
│   │   │   └── $id.tsx            (карточка)
│   │   ├── questionnaires/
│   │   ├── orders/                (накази)
│   │   └── settings/
│   │       └── import-mis.tsx
│   ├── components/
│   │   ├── ui/                    (shadcn)
│   │   ├── PatientsTable.tsx
│   │   ├── PatientCard.tsx
│   │   ├── FluoroTimeline.tsx
│   │   ├── QuestionnaireForm.tsx
│   │   └── ExportButton.tsx
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── auth.ts
│   │   ├── risk-groups-mapping.ts (раздел 8)
│   │   ├── xlsx-import.ts
│   │   ├── xlsx-export.ts
│   │   └── date-utils.ts
│   ├── hooks/
│   │   ├── usePatients.ts
│   │   ├── useDashboardStats.ts
│   │   └── ...
│   └── types/
│       └── database.ts            (генерируется через `supabase gen types`)
└── extension-bridge/              (новые файлы для расширения)
    ├── tb-module-bridge.js
    └── tb-module-ui.js
```

---

## 10. Старт работы с Claude Code

### Подготовка пользователя (до первой сессии)

1. Создать Supabase проект на supabase.com (free tier), сохранить URL + anon key + service role key
2. Создать Vercel аккаунт, привязать к GitHub
3. Создать пустой GitHub репо `tb-module`
4. Подготовить тестовый xlsx-выгрузку из МИС (можно с фейковыми ПІБ, но реальной структурой колонок)

### Промт для первой сессии Claude Code

> «Прочитай `tb_module_plan.md`. Начни с Фазы 0. Создай Vite+React+TS проект, настрой Tailwind+shadcn, накати миграцию из supabase/migrations/0001_initial.sql, реализуй PIN-auth через Vercel Edge Function, создай скелет с сайдбаром и 5 пустыми страницами. После завершения — DoD: я ввожу PIN и попадаю на пустой дашборд.»

### Дальнейший workflow

Каждая фаза = отдельная сессия Claude Code. Перед каждой фазой:
1. Открыть план, перечитать DoD текущей фазы
2. Стартовый промт: «Прочитай `tb_module_plan.md`, выполни Фазу N. По завершении — DoD: …»
3. После DoD — git commit + git tag `phase-N-complete`
4. Переход к следующей фазе

### Параллельно с Фазой 1

Пользователь готовит свежий выгрузка декларантов из МИС с указанной структурой колонок. Желательно с диагнозами по каждому пациенту (для авто-заполнения `medical_risk_groups` при импорте).

---

## Не входит в v1, но запланировано

- Модули по другим направлениям (ВІЛ, ССЗ, Онко) — переиспользуют ту же инфраструктуру
- SMS-напоминания пациентам через Turbosms / Eskiz
- Двусторонний sync с МИС через API (если/когда medics.ua откроет API)
- 2FA (если PIN перестанет хватать)
- Резервные бэкапы в S3/Backblaze
- Темная тема
