import { createClient } from '@supabase/supabase-js';

// When these env vars are absent the app runs in "local mode": no accounts,
// progress stays in localStorage. Add a free Supabase project's URL + anon key
// to .env to light up cloud accounts and sync. See README.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;
