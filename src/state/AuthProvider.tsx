import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

type UserRow = { id: string; role: 'admin'|'vendor'; full_name: string|null; gain_pct?: number|null; cabinet_pct_ge12?: number|null };

const Ctx = createContext<{ session: Session|null; userRow: UserRow|null; loading: boolean; signOut: () => Promise<void>}>({
  session: null,
  userRow: null,
  loading: true,
  signOut: async () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session|null>(null);
  const [userRow, setUserRow] = useState<UserRow|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, s: Session | null) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!session?.user) { setUserRow(null); return; }
      const { data } = await supabase
        .from('users')
        .select('id, role, full_name, gain_pct, cabinet_pct_ge12')
        .eq('id', session.user.id)
        .single();
      setUserRow(data as UserRow);
    };
    load();
  }, [session?.user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); };
  return <Ctx.Provider value={{ session, userRow, loading, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
