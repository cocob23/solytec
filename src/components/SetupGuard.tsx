import { envOk } from '../lib/supabaseClient';

export function SetupGuard({ children }: { children: React.ReactNode }) {
  if (!envOk) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-xl font-semibold">Configuración requerida</h2>
          <p className="text-sm text-gray-600">
            Faltan las variables de entorno de Supabase.
            Creá un archivo <code>.env.local</code> con:
          </p>
          <pre className="bg-gray-100 p-3 rounded text-left text-sm">VITE_SUPABASE_URL=TU_URL{`\n`}VITE_SUPABASE_ANON_KEY=TU_ANON_KEY</pre>
          <p className="text-sm text-gray-600">Luego reiniciá el servidor de desarrollo.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
