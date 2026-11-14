import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { roleLabel } from '@/lib/labels';

const LINKS: { to: string; label: string; roles: string[] }[] = [
  { to: '/admin', label: 'Painel', roles: ['admin', 'gestor', 'atendente', 'lancador_fila', 'auditor'] },
  { to: '/admin/cidadaos', label: 'Cidadãos', roles: ['admin', 'gestor', 'auditor', 'atendente'] },
  { to: '/admin/campanhas', label: 'Campanhas', roles: ['admin', 'gestor', 'auditor'] },
  { to: '/admin/servidores', label: 'Servidores', roles: ['admin', 'gestor'] },
  { to: '/admin/midias', label: 'Mídias', roles: ['admin', 'gestor', 'auditor'] },
  { to: '/admin/filas', label: 'Filas', roles: ['admin', 'gestor', 'atendente', 'lancador_fila'] },
  { to: '/admin/tv', label: 'TVs', roles: ['admin', 'gestor', 'atendente', 'lancador_fila', 'auditor'] },
  { to: '/admin/franquia', label: 'Franquia', roles: ['admin', 'gestor', 'auditor'] },
  { to: '/admin/poc', label: 'Lote POC', roles: ['admin', 'gestor'] },
  { to: '/admin/auditoria', label: 'Auditoria', roles: ['admin', 'gestor', 'auditor'] },
  { to: '/admin/lgpd', label: 'LGPD', roles: ['admin', 'gestor', 'auditor', 'atendente'] },
  { to: '/admin/relatorios', label: 'Relatórios', roles: ['admin', 'gestor', 'auditor'] },
  { to: '/admin/chatwoot', label: 'Chatwoot', roles: ['admin', 'gestor', 'atendente', 'auditor'] },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const links = LINKS.filter((link) => user && link.roles.includes(user.role));
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className={`${open ? 'block' : 'hidden'} border-b border-white/10 bg-[#102033] text-[#f4efe6] md:block`}>
        <div className="px-4 py-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#c4a46a]">Pompéu/MG</p>
          <p className="display text-xl">WRP Comunicação</p>
          <p className="mt-2 text-xs text-white/70">{user?.name}<br />{user ? roleLabel(user.role) : ''}</p>
        </div>
        <nav className="flex flex-col px-2 pb-6">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/admin'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white/10 text-[#c4a46a]' : 'text-white/80'}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {/* min-w-0: tabela larga rola dentro do próprio quadro, sem empurrar a página para o lado. */}
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <Button variant="outline" size="sm" className="md:hidden" onClick={() => setOpen((value) => !value)}>Menu</Button>
          <p className="text-sm text-muted-foreground">Pregão 089/2026 · atendimento humano</p>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>Sair</Button>
        </header>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
