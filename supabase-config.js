// Paste your Supabase URL and Anon Key here:
const SUPABASE_URL = "https://ixczvfnzttmiecgqoiek.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4Y3p2Zm56dHRtaWVjZ3FvaWVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODEyNzAsImV4cCI6MjA5NjE1NzI3MH0.aFvyi9hsXxN-21AS1ecaBI0OzYLkdxbsqVLIJtC3xGU";

// Initialize Supabase Client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
