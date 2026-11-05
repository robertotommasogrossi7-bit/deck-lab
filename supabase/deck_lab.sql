-- Deck Lab online: stanze a due telefoni e partite salvate.
-- Le tabelle sono chiuse (sicurezza a livello di riga attiva e nessuna regola): i telefoni usano
-- solo le funzioni qui sotto, che girano con i permessi del proprietario.
-- Si puo' rilanciare: crea o aggiorna senza cancellare i dati.

create table if not exists public.rooms (
  code text primary key,
  version integer not null default 0,
  seats jsonb not null default '[]'::jsonb,      -- [{name, deck, sleeve}, ...] posto 0 e 1
  state jsonb,                                   -- la partita (null prima di cominciare)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_versions (
  code text not null references public.rooms(code) on delete cascade,
  version integer not null,
  state jsonb,
  kind text not null default 'move',             -- move (si annulla) | auto | undo | start
  undone boolean not null default false,
  seat smallint,
  created_at timestamptz not null default now(),
  primary key (code, version)
);

create table if not exists public.games (
  id bigint generated always as identity primary key,
  client_id text unique,
  started_at text,
  ended_at text,
  mode text,
  p1_name text, p1_deck text, p1_hash text,
  p2_name text, p2_deck text, p2_hash text,
  first_player smallint, winner smallint, reason text, turns integer,
  p1_life integer, p2_life integer, p1_mulligans smallint, p2_mulligans smallint,
  match_id text, game_no integer, note text,
  log jsonb not null default '[]'::jsonb,
  room text,
  created_at timestamptz not null default now()
);
create index if not exists games_p1_deck on public.games (p1_deck);
create index if not exists games_p2_deck on public.games (p2_deck);

alter table public.rooms enable row level security;
alter table public.room_versions enable row level security;
alter table public.games enable row level security;
revoke all on public.rooms, public.room_versions, public.games from anon, authenticated;

-- ---- aiuti interni ------------------------------------------------------------------------------
create or replace function public._int(t text) returns integer
language plpgsql immutable set search_path = public as $$
begin
  return round(t::numeric)::integer;
exception when others then
  return null;
end $$;

create or replace function public._seat(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'name', left(coalesce(nullif(trim(p->>'name'), ''), 'Giocatore'), 20),
    'deck', left(coalesce(p->>'deck', ''), 80),
    'sleeve', left(coalesce(nullif(p->>'sleeve', ''), 'rosso'), 12))
$$;

-- ---- stanze ---------------------------------------------------------------------------------------
create or replace function public.room_create(p_seat jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  i integer;
begin
  delete from rooms where updated_at < now() - interval '14 days';
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1);
    end loop;
    exit when not exists (select 1 from rooms where code = v_code);
  end loop;
  insert into rooms (code, seats) values (v_code, jsonb_build_array(_seat(p_seat)));
  return jsonb_build_object('ok', true, 'code', v_code, 'seat', 0, 'version', 0);
end $$;

create or replace function public.room_join(p_code text, p_seat jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  if jsonb_array_length(r.seats) >= 2 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  update rooms set seats = seats || jsonb_build_array(_seat(p_seat)), version = version + 1, updated_at = now()
   where code = r.code;
  return jsonb_build_object('ok', true, 'code', r.code, 'seat', jsonb_array_length(r.seats), 'version', r.version + 1);
end $$;

-- cambia nome, mazzo o bustine di un posto (prima di cominciare o tra una partita e l'altra)
create or replace function public.room_seat(p_code text, p_index integer, p_seat jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(r.seats) then
    return jsonb_build_object('ok', false, 'error', 'seat');
  end if;
  update rooms set seats = jsonb_set(seats, array[p_index::text], _seat(p_seat)), version = version + 1, updated_at = now()
   where code = r.code;
  return jsonb_build_object('ok', true, 'version', r.version + 1);
end $$;

create or replace function public.room_get(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', code, 'version', version, 'seats', seats, 'state', state, 'updated_at', updated_at)
    from rooms where code = upper(trim(p_code))
$$;

create or replace function public.room_version(p_code text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select version from rooms where code = upper(trim(p_code))), -1)
$$;

-- una mossa: vale solo se parte dall'ultima versione, altrimenti il telefono la rifa' sopra
create or replace function public.room_push(p_code text, p_base integer, p_state jsonb,
                                            p_kind text default 'move', p_seat integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
  v integer;
begin
  if p_state is null then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if octet_length(p_state::text) > 3000000 then
    return jsonb_build_object('ok', false, 'error', 'too_big');
  end if;
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  if r.version <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', r.version);
  end if;
  v := r.version + 1;
  update rooms set version = v, state = p_state, updated_at = now() where code = r.code;
  insert into room_versions (code, version, state, kind, seat)
  values (r.code, v, p_state, case when p_kind in ('move', 'auto', 'start') then p_kind else 'move' end, p_seat);
  delete from room_versions where code = r.code and version <= v - 60;
  return jsonb_build_object('ok', true, 'version', v);
end $$;

-- annulla l'ultima mossa (di chiunque) dall'inizio della partita: torna allo stato di prima
create or replace function public.room_undo(p_code text, p_base integer, p_seat integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rooms;
  barrier integer;
  m integer;
  prev jsonb;
  v integer;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  if r.version <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', r.version);
  end if;
  select coalesce(max(version), 0) into barrier from room_versions where code = r.code and kind = 'start';
  select max(version) into m from room_versions
   where code = r.code and kind = 'move' and not undone and version > barrier;
  if m is null then
    return jsonb_build_object('ok', false, 'error', 'nothing');
  end if;
  select state into prev from room_versions where code = r.code and version = m - 1;
  if prev is null then
    return jsonb_build_object('ok', false, 'error', 'too_old');
  end if;
  v := r.version + 1;
  update room_versions set undone = true where code = r.code and version = m;
  update rooms set version = v, state = prev, updated_at = now() where code = r.code;
  insert into room_versions (code, version, state, kind, seat) values (r.code, v, prev, 'undo', p_seat);
  delete from room_versions where code = r.code and version <= v - 60;
  return jsonb_build_object('ok', true, 'version', v, 'undone', m);
end $$;

-- ---- partite --------------------------------------------------------------------------------------
create or replace function public.game_save(p_game jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p1 jsonb := coalesce(p_game->'p1', '{}'::jsonb);
  p2 jsonb := coalesce(p_game->'p2', '{}'::jsonb);
  w integer := _int(p_game->>'winner');
  v_id bigint;
begin
  if coalesce(p1->>'deck', '') = '' then
    raise exception 'Manca il mazzo del giocatore 1.';
  end if;
  if w is not null and w not in (1, 2) then
    raise exception 'Vincitore non valido.';
  end if;
  insert into games (client_id, started_at, ended_at, mode, p1_name, p1_deck, p1_hash, p2_name, p2_deck,
                     p2_hash, first_player, winner, reason, turns, p1_life, p2_life, p1_mulligans,
                     p2_mulligans, match_id, game_no, note, log, room)
  values (p_game->>'client_id', p_game->>'started_at',
          coalesce(p_game->>'ended_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          case when p_game->>'mode' in ('duo', 'solo') then p_game->>'mode' else 'duo' end,
          left(p1->>'name', 40), p1->>'deck', p1->>'hash', left(p2->>'name', 40), p2->>'deck', p2->>'hash',
          _int(p_game->>'first_player'), w, left(coalesce(p_game->>'reason', ''), 60), _int(p_game->>'turns'),
          _int(p1->>'life'), _int(p2->>'life'), _int(p1->>'mulligans'), _int(p2->>'mulligans'),
          p_game->>'match_id', _int(p_game->>'game_no'), left(coalesce(p_game->>'note', ''), 2000),
          coalesce(p_game->'log', '[]'::jsonb), p_game->>'room')
  on conflict (client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from games where client_id = p_game->>'client_id';
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.games_list(p_deck text default null, p_limit integer default 100) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(g) - 'log' order by g.id desc), '[]'::jsonb)
    from (select * from games
           where p_deck is null or p1_deck = p_deck or p2_deck = p_deck
           order by id desc
           limit least(greatest(coalesce(p_limit, 100), 1), 5000)) g
$$;

create or replace function public.game_get(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(g) from games g where g.id = p_id
$$;

-- ---- chi puo' chiamare cosa -----------------------------------------------------------------------
revoke execute on function public._int(text), public._seat(jsonb) from public, anon, authenticated;
grant execute on function
  public.room_create(jsonb), public.room_join(text, jsonb), public.room_seat(text, integer, jsonb),
  public.room_get(text), public.room_version(text), public.room_push(text, integer, jsonb, text, integer),
  public.room_undo(text, integer, integer), public.game_save(jsonb), public.games_list(text, integer),
  public.game_get(bigint)
to anon, authenticated;
