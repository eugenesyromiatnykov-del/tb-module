-- Naming caveat: this `orders` table holds MOZ orders (наказы), not e-commerce
-- orders. Plan section 4 calls them "Накази".
create table if not exists orders (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  url         text not null,
  notes       text,
  category    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists orders_title on orders (title);

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

alter table orders enable row level security;
