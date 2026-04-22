// Copy this file to config.js and fill in your values.
// config.js is gitignored — never commit it.
const SUPABASE_URL = 'https://your-project-ref.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
const TUMBLR_CLIENT_ID = 'your-tumblr-oauth2-client-id';
window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.TUMBLR_CLIENT_ID = TUMBLR_CLIENT_ID;
window.SUPABASE_URL = SUPABASE_URL;
