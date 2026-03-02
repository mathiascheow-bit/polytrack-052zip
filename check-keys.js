import 'dotenv/config'; // This loads the .env file

console.log('--- Database Key Check ---');
console.log('URL Found:', process.env.VITE_SUPABASE_URL ? '✅ Yes' : '❌ MISSING');
console.log('Key Found:', process.env.VITE_SUPABASE_ANON_KEY ? '✅ Yes' : '❌ MISSING');

if (process.env.VITE_SUPABASE_URL) {
  console.log('URL Value:', process.env.VITE_SUPABASE_URL);
}