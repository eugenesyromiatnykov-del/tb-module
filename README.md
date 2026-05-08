# Модуль ТБ

Веб-додаток для ведення випадків туберкульозу в практиці сімейного лікаря (Білогірська амбулаторія + Залужжя).

Повна специфікація — у [`tb_module_plan.md`](./tb_module_plan.md).

---

## Стек

- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS v4
- **Маршрутизація:** React Router v6
- **Дані:** TanStack Query + Supabase (PostgreSQL)
- **Форми:** react-hook-form + zod
- **Excel:** SheetJS (`xlsx`) на клієнті
- **Auth:** PIN практики → bcrypt → JWT (HS256) у HttpOnly-cookie
- **Hosting:** Vercel (frontend + API routes), Supabase free tier

---

## Швидкий старт (локально)

```bash
# 1. Встановити залежності
npm install

# 2. Скопіювати приклад env
cp .env.example .env.local

# 3. Згенерувати hash PIN-коду
npm run hash-pin -- 12345678
# Скопіювати вивід у PIN_HASH= у .env.local

# 4. Згенерувати JWT_SECRET
openssl rand -base64 48
# Скопіювати у JWT_SECRET= у .env.local

# 5. Запустити dev-сервер
npm run dev
```

> **Важливо:** Vite dev-server віддає тільки SPA. API-функції (`/api/auth/*`) працюють лише на Vercel або через `vercel dev`. Для повного локального тесту авторизації встановіть `npm i -g vercel` і запустіть `vercel dev`.

---

## Підготовка зовнішніх сервісів (one-time)

### 1. Supabase

1. Зайти на [supabase.com](https://supabase.com) → **New project**
2. Назва: `tb-module`, регіон: `eu-central-1` (Frankfurt)
3. Зберегти **Database password** (знадобиться для psql)
4. Project Settings → API скопіювати:
   - **Project URL** → у `.env.local` як `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (тільки в env Vercel, **не** на клієнті)
5. SQL Editor → New query → вставити вміст `supabase/migrations/0001_initial.sql` → **Run**
6. (Опціонально) налаштувати RLS — буде у Фазі 1

### 2. GitHub

```bash
cd /Users/eugenesyromiatnykov/work/TBmodule
git init -b main
git add -A
git commit -m "Phase 0: project skeleton"
gh repo create tb-module --private --source=. --push
```

### 3. Vercel

1. [vercel.com](https://vercel.com) → **Add new… → Project** → імпорт `tb-module`
2. Framework: **Vite** (визначиться автоматично)
3. Environment variables (для Production + Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PIN_HASH` (вивід `npm run hash-pin -- <PIN>`)
   - `JWT_SECRET` (вивід `openssl rand -base64 48`)
   - `RESEND_API_KEY` (Фаза 2)
   - `DIGEST_RECIPIENTS=eugene.syromiatnykov@gmail.com,knecolena@gmail.com`
4. Deploy

---

## Структура

```
TBmodule/
├── tb_module_plan.md          мастер-план (read-only specification)
├── api/                       Vercel serverless functions
│   ├── _lib/                  спільні утиліти (jwt, rate-limit)
│   └── auth/                  login, logout, me
├── supabase/
│   └── migrations/
│       └── 0001_initial.sql   повний DDL з розділу 3 плану
├── scripts/
│   └── hash-pin.mjs           утиліта генерації bcrypt-хешу
├── src/
│   ├── components/            UI-компоненти + layout + auth-guard
│   ├── routes/                сторінки (login, dashboard, patients, …)
│   ├── lib/                   supabase client, auth helpers, utils
│   └── App.tsx                root + роутинг
├── .env.example               шаблон env (без секретів)
├── package.json
└── vercel.json                framework=vite + SPA rewrites
```

---

## Дорожня карта

| Фаза | Назва | Статус |
|------|-------|--------|
| 0 | Фундамент (auth, скелет) | ✅ В роботі |
| 1 | Єдина база (імпорт декларантів, реєстр пацієнтів) | ⏳ |
| 2 | Дашборд + email-дайджести | ⏳ |
| 3 | Опросник додаток 9 + генерація направлень | ⏳ |
| 4 | Накази + інтеграція з Chrome-розширенням | ⏳ |

DoD кожної фази — у `tb_module_plan.md` розділ 7.

---

## Безпека

- PIN зберігається тільки як bcrypt-хеш в env Vercel.
- 5 невірних спроб з одного IP → 15-хвилинний lockout (in-memory fallback або Upstash Redis за наявності).
- JWT-cookie: `HttpOnly; Secure; SameSite=Lax; Max-Age=30 днів`.
- Service role key Supabase ніколи не потрапляє в bundle (без префіксу `VITE_`).
- `.env.local` у `.gitignore`.
