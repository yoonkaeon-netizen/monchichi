// SUPABASE_URL 이 있으면 Supabase, 없으면 로컬 파일 DB를 쓴다.
let store;

export async function getStore() {
  if (store) return store;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    const { createSupabaseStore } = await import('./supabase.js');
    store = createSupabaseStore(url, key);
  } else if (process.env.VERCEL) {
    throw new Error('Vercel 환경 변수에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 설정해 주세요.');
  } else {
    const { createLocalStore } = await import('./local.js');
    store = createLocalStore();
  }
  return store;
}
