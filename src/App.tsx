import React, { useState, useEffect, Component, ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { MessageCircle, Calendar, BarChart3, Settings, LogOut, Menu, X, Send, Plus, CreditCard as Edit2, Search, Filter, Bell, User, Clock, TrendingUp, Users, CheckCircle, Home, FileText, DollarSign, Phone, Upload, MapPin, Info, Check, Zap, Smile } from 'lucide-react';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; msg: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, msg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, msg: error.message };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error('UI error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white px-4">
          <div className="max-w-md text-center space-y-3">
            <h1 className="text-2xl font-bold">Ups, algo se rompió</h1>
            <p className="text-slate-400 text-sm">
              Refresca la página. Si continúa, comparte este mensaje: <span className="text-indigo-300 font-mono text-xs">{this.state.msg}</span>
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RootApp() {
  const [auth, setAuth] = useState(false);
  const [loginMode, setLoginMode] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [tab, setTab] = useState('lobby');
  const [dashboardTab, setDashboardTab] = useState('overview');
  const [settingsTab, setSettingsTab] = useState('general');
  const [appointmentsView, setAppointmentsView] = useState<'calendar' | 'list'>('calendar');
  const [calendarMode, setCalendarMode] = useState<'dia' | 'semana' | 'mes' | 'año'>('semana');
  const [theme] = useState<'dark' | 'light'>('light');
  const [autoMode, setAutoMode] = useState(true);
  const [clinicId] = useState<string>(import.meta.env.VITE_CLINIC_ID || '8cba38dd-2da4-4388-a931-eaa9550b33bb');
  const [messageDraft, setMessageDraft] = useState('');
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://oeeyzqqnxvcpibdwuugu.supabase.co';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lZXl6cXFueHZjcGliZHd1dWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxODU2OTEsImV4cCI6MjA3NTc2MTY5MX0.bjKLmyZX4eIxKDWIwBxM0Wg6bKZoVeECvA4tzzuh8lk';
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const n8nSendUrl = import.meta.env.VITE_N8N_SEND_URL || '';
  const [selected, setSelected] = useState<{id: string; name: string; msg: string; time: string; unread: number} | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [editingChat, setEditingChat] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications] = useState(false);
  const [showAllLobbyNotifications, setShowAllLobbyNotifications] = useState(false);

  const [liveStats, setLiveStats] = useState({
    messages: 42,
    appointments: 12,
    responseRate: 98,
    activePatients: 156
  });

  const [timeSlotsPercent, setTimeSlotsPercent] = useState([85, 65, 45, 35]);
  const [satisfactionPercent, setSatisfactionPercent] = useState(90);

  const [form, setForm] = useState({ email: '', pass: '', name: '', clinic: '', phone: '' });
  const [clinic, setClinic] = useState({ name: 'Mi Clínica Dental', phone: '+504 9000-0000' });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // SCROLL TO TOP cuando cambia tab
  useEffect(() => {
    // Scroll reset when cambia la sección
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [tab]);

  useEffect(() => {
    if (tab === 'analytics') {
      const interval = setInterval(() => {
        setLiveStats(prev => ({
          messages: prev.messages + Math.floor(Math.random() * 3),
          appointments: prev.appointments + (Math.random() > 0.7 ? 1 : 0),
          responseRate: Math.min(100, prev.responseRate + (Math.random() > 0.5 ? 0.1 : -0.1)),
          activePatients: prev.activePatients + (Math.random() > 0.8 ? 1 : 0)
        }));
        setTimeSlotsPercent(prev => prev.map(p =>
          Math.max(20, Math.min(95, p + (Math.random() - 0.5) * 5))
        ));
        setSatisfactionPercent(prev =>
          Math.max(85, Math.min(98, prev + (Math.random() - 0.5) * 2))
        );
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [tab]);

  const loadData = async () => {
    const { data: appointmentsData } = await supabase
      .from('appointments')
      .select('id, service, start_at, status, source_conversation, contacts:contact_id(full_name)')
      .limit(20);
    if (appointmentsData) {
      setSchedule(appointmentsData.map((a, idx) => ({
        id: idx + 1,
        name: (a as any).contacts?.full_name || 'Paciente',
        service: a.service || 'Cita',
        date: a.start_at ? new Date(a.start_at).toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) : '',
        time: a.start_at ? new Date(a.start_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }) : '',
        status: a.status || 'pendiente',
        channel: 'WhatsApp'
      })));
    }

    const { data: contactsData } = await supabase
      .from('contacts')
      .select('full_name, created_at')
      .limit(10);
    if (contactsData) {
      setPatients(contactsData.map((c) => ({
        name: c.full_name || 'Paciente',
        status: 'activo',
        phone: '—',
        lastVisit: c.created_at ? new Date(c.created_at).toLocaleDateString('es-HN') : '—',
        location: '—',
        notes: 'Desde Supabase'
      })));
    }
  };

  const loadConversations = async () => {
    setLoadingChats(true);
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, contact_id, updated_at, contacts:contact_id(full_name)')
      .limit(20)
      .order('updated_at', { ascending: false });

    const { data: msgsData } = await supabase
      .from('messages')
      .select('conversation_id, body, created_at, direction')
      .order('created_at', { ascending: false })
      .limit(200);

    if (convs) {
      const mapped = convs.map((c) => {
        const lastMsg = msgsData?.find((m) => m.conversation_id === c.id);
        return {
          id: c.id as string,
          name: (c as any).contacts?.full_name || 'Paciente',
          msg: lastMsg?.body || 'Sin mensajes',
          time: lastMsg?.created_at ? new Date(lastMsg.created_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }) : '',
          unread: 0
        };
      });
      setChats(mapped);
      if (!selected && mapped.length > 0) setSelected(mapped[0]);
    }
    setLoadingChats(false);
  };

  const loadMessages = async (conversationId: string) => {
    const { data: messagesData } = await supabase
      .from('messages')
      .select('body, created_at, direction')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (messagesData) {
      setMsgs(messagesData.map((m) => ({
        from: m.direction === 'inbound' ? 'user' : 'bot',
        text: m.body || '',
        time: m.created_at ? new Date(m.created_at).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }) : ''
      })));
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadData();
        await loadConversations();
        if (clinicId) {
          const { data } = await supabase
            .from('clinics')
            .select('auto_mode')
            .eq('id', clinicId)
            .single();
          if (data && typeof (data as any).auto_mode === 'boolean') {
            setAutoMode((data as any).auto_mode);
          }
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  const persistAutoMode = async (next: boolean) => {
    setAutoMode(next);
    if (!clinicId) return;
    await supabase.from('clinics').update({ auto_mode: next }).eq('id', clinicId);
  };

  const handleSendMessage = async () => {
    if (!selected || !messageDraft.trim()) return;
    const outbound = {
      conversation_id: selected.id,
      text: messageDraft.trim()
    };

    if (n8nSendUrl) {
      fetch(n8nSendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outbound)
      }).catch(() => {});
    }

    setMsgs(prev => [...prev, { from: 'bot', text: messageDraft.trim(), time: new Date().toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }) }]);
    setMessageDraft('');
  };

  const [chats, setChats] = useState<{id: string; name: string; msg: string; time: string; unread: number}[]>([]);
  const [msgs, setMsgs] = useState<{from: 'user' | 'bot'; text: string; time: string}[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);

  const notifications = [
    { id: 1, text: 'Nueva cita agendada', time: '5m', type: 'success' },
    { id: 2, text: 'Recordatorio: Cita en 30 min', time: '15m', type: 'warning' },
    { id: 3, text: 'Pago recibido de Juan Pérez', time: '1h', type: 'info' }
  ];

  const [schedule, setSchedule] = useState<{id: number; name: string; service: string; date: string; time: string; status: string; channel: string}[]>([
    { id: 1, name: 'Juan Pérez', service: 'Limpieza', date: 'Hoy', time: '10:00 AM', status: 'confirmada', channel: 'WhatsApp' }
  ]);

  const [patients, setPatients] = useState<{ name: string; status: string; phone: string; lastVisit: string; location: string; notes: string }[]>([
    { name: 'Paciente demo', status: 'activo', phone: '—', lastVisit: '—', location: '—', notes: 'Sincroniza con Supabase' }
  ]);

  const paymentHistory = [
    { id: 1, patient: 'Juan Pérez', amount: 150, status: 'pagado', method: 'Tarjeta', date: '15 Dic' },
    { id: 2, patient: 'María López', amount: 80, status: 'pendiente', method: 'Transferencia', date: '15 Dic' },
    { id: 3, patient: 'Ana García', amount: 220, status: 'pagado', method: 'Efectivo', date: '14 Dic' },
    { id: 4, patient: 'Carlos Rodríguez', amount: 95, status: 'reembolsado', method: 'Tarjeta', date: '13 Dic' }
  ];

  const reportCards = [
    { title: 'Citas completadas', value: '42', change: '+8%', icon: CheckCircle, color: 'emerald' },
    { title: 'Ingresos', value: '$8.5k', change: '+12%', icon: DollarSign, color: 'indigo' },
    { title: 'Nuevos pacientes', value: '18', change: '+5%', icon: Users, color: 'blue' },
    { title: 'Tasa de respuesta', value: '98%', change: '+1%', icon: TrendingUp, color: 'teal' }
  ];

  const integrations = [
    { name: 'WhatsApp Automático', status: 'activo', detail: 'Sesión con QR, responde en minutos', icon: MessageCircle, requiresQr: true },
    { name: 'Instagram / Messenger', status: 'pendiente', detail: 'Unifica bandeja cuando esté listo', icon: MessageCircle },
    { name: 'Calendario Google', status: 'sincronizado', detail: 'Actualiza agenda en tiempo real', icon: Calendar },
    { name: 'Pagos Stripe', status: 'activo', detail: 'Cobros seguros y rápidos', icon: DollarSign },
    { name: 'Notificaciones push', status: 'beta', detail: 'Alertas en móviles', icon: Bell }
  ];

  // COLORES PROFESIONALES (no dulces)
  const avatarColors = [
    'from-slate-700 to-slate-800',
    'from-indigo-700 to-indigo-800',
    'from-sky-700 to-sky-800',
    'from-slate-600 to-slate-700'
  ];

  const getAvatarColor = (id: number | string) => {
    const num = typeof id === 'string' ? id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) : id;
    return avatarColors[num % avatarColors.length];
  };

  const filteredChats = chats.filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.msg.toLowerCase().includes(searchQuery.toLowerCase())
  );


  const login = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.email && form.pass) {
      setAuth(true);
      setForm({ email: '', pass: '', name: '', clinic: '', phone: '' });
    }
  };

  const register = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name && form.clinic && form.email && form.pass) {
      setClinic({ name: form.clinic, phone: form.phone });
      setAuth(true);
      setForm({ email: '', pass: '', name: '', clinic: '', phone: '' });
    }
  };

  const isDark = theme === 'dark';
  const textMain = isDark ? 'text-white' : 'text-slate-900';
  const textSub = isDark ? 'text-slate-400' : 'text-slate-600';

  if (!auth) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{backgroundColor: '#0a0b0d'}}>
        <div className="w-full max-w-md space-y-4">
          <div className="text-center">
            <div className="mx-auto relative inline-flex px-6 py-4">
              <div className="absolute inset-0 blur-3xl bg-indigo-500/30 rounded-full"></div>
              <span className="relative text-white font-black text-3xl tracking-tight" style={{fontFamily: 'Helvetica Neue, Inter, sans-serif'}}>
                DentalConnect
              </span>
            </div>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl p-5 backdrop-blur">
              <div className="flex items-center justify-end mb-4">
                <button
                  type="button"
                  onClick={() => setLoginMode(!loginMode)}
                  className="text-xs text-sky-300 hover:text-sky-200"
                >
                  {loginMode ? 'Crear cuenta' : 'Ya tengo cuenta'}
                </button>
              </div>

              {!loginMode ? (
              <form onSubmit={register} className="space-y-3">
                <input
                  type="text"
                  placeholder="Nombre de la clínica"
                  value={form.clinic}
                  onChange={(e) => setForm({...form, clinic: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
                <input
                  type="text"
                  placeholder="Tu nombre"
                  value={form.name}
                  onChange={(e) => setForm({...form, name: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={form.pass}
                  onChange={(e) => setForm({...form, pass: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
                <button
                  type="submit"
                  className="relative w-full bg-gradient-to-r from-indigo-500 to-teal-500 hover:from-indigo-400 hover:to-teal-400 text-white font-bold py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/50 hover:scale-[1.02] overflow-hidden group text-sm"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                  <span className="relative">Crear Cuenta</span>
                </button>
              </form>
            ) : (
              <form onSubmit={login} className="space-y-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={form.pass}
                  onChange={(e) => setForm({...form, pass: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
                <button
                  type="submit"
                  className="relative w-full bg-gradient-to-r from-indigo-500 to-teal-500 hover:from-indigo-400 hover:to-teal-400 text-white font-bold py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/50 hover:scale-[1.02] overflow-hidden group text-sm"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                  <span className="relative">Iniciar Sesión</span>
                </button>
              </form>
            )}

            <div className="mt-4 pt-4 border-t border-slate-800">
              <p className="text-center text-slate-400 text-xs">
                Powered by <span className="font-semibold text-white">creatyv.io</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const menuItems = [
    { id: 'messages', icon: MessageCircle, label: 'Mensajes', badge: 6 },
    { id: 'appointments', icon: Calendar, label: 'Citas', badge: 3 },
    { id: 'patients', icon: Users, label: 'Pacientes' },
    { id: 'payments', icon: DollarSign, label: 'Pagos' },
    { id: 'reports', icon: FileText, label: 'Reportes' },
    { id: 'analytics', icon: BarChart3, label: 'Analítica' },
    { id: 'settings', icon: Settings, label: 'Configuración' }
  ];

  return (
    <div className={`flex h-screen theme-${theme}`} style={{backgroundColor: isDark ? '#0a0b0d' : '#f5f7fb'}}>
      {/* TOP BAR MÓVIL - SIMPLE */}
      {isMobile && (
        <div 
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 h-[48px]"
          style={{
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: '4px'
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-slate-700 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-sm flex-shrink-0">
              {clinic.name.charAt(0)}
            </div>
            <div className="leading-tight min-w-0">
              <span className="block text-slate-900 text-[13px] font-semibold leading-tight truncate max-w-[140px]">DentalConnect</span>
              <span className="block text-slate-500 text-[11px] truncate max-w-[140px] leading-tight">{clinic.name}</span>
            </div>
          </div>
          <button
            onClick={() => setSidebar(!sidebar)}
            className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:border-slate-300 transition flex-shrink-0 bg-white"
            aria-label="Menú"
          >
            <Menu size={18} />
          </button>
        </div>
      )}

      {/* SIDEBAR */}
        {((!isMobile) || (isMobile && sidebar)) && (
        <>
          {isMobile && (
            <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSidebar(false)}></div>
          )}
          <div className={`${isMobile ? 'fixed top-0 left-0 h-screen' : 'fixed left-0 top-0 h-screen'} w-64 text-white flex flex-col shadow-xl z-50`} style={{backgroundColor: '#13151a', borderRight: '1px solid #1e293b'}}>
        <div className="p-5" style={{borderBottom: '1px solid #1e293b'}}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-indigo-500 to-teal-500 rounded-xl flex items-center justify-center font-bold text-white text-base flex-shrink-0 shadow-lg shadow-indigo-500/30">
              {clinic.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-bold truncate text-sm">{clinic.name}</h2>
              <p className="text-slate-400 text-xs">Dashboard Pro</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          <button
            onClick={() => {setTab('lobby'); if(isMobile) setSidebar(false);}}
            className={`w-full flex items-center gap-3 px-3 py-2.5 md:px-4 md:py-3 rounded-lg transition group ${
              tab === 'lobby'
                ? 'text-white border-2 border-indigo-500/50 bg-indigo-500/10'
                : 'text-slate-400 hover:text-white border-2 border-transparent transition-all duration-200 hover:bg-[#1c1f26]'
            }`}
          >
            <Home size={19} strokeWidth={2} />
            <span className="font-semibold text-sm">Sala de Espera</span>
          </button>
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => {setTab(item.id); if(isMobile) setSidebar(false);}}
              className={`w-full flex items-center gap-3 px-3 py-2.5 md:px-4 md:py-3 rounded-lg transition relative group ${
                tab === item.id
                  ? 'text-white border-2 border-indigo-500/50 bg-indigo-500/10'
                  : 'text-slate-400 hover:text-white border-2 border-transparent transition-all duration-200 hover:bg-[#1c1f26]'
              }`}
            >
              <item.icon size={19} strokeWidth={2} />
              <span className="font-semibold text-sm flex-1 text-left">{item.label}</span>
              {item.badge && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-3 space-y-0.5" style={{borderTop: '1px solid #1e293b'}}>
          <button onClick={() => setAuth(false)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-red-900/30 transition text-slate-400 hover:text-red-400">
            <LogOut size={19} />
            <span className="font-semibold text-sm">Salir</span>
          </button>
        </div>
        </div>
        </>
      )}

      {/* MAIN CONTENT */}
      <div 
        className={`flex-1 flex flex-col ${!isMobile ? 'ml-64' : ''}`} 
        style={isMobile ? {
          paddingTop: 'calc(48px + env(safe-area-inset-top) + 6px)',
          paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))'
        } : { paddingTop: '12px', paddingBottom: '16px' }}
      >

        {showNotifications && (
          <div className="px-4 md:px-8 mt-2">
            <div className={`rounded-2xl p-4 grid md:grid-cols-3 gap-3 border ${
              theme === 'dark' ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${
                    theme === 'dark' ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    n.type === 'success' ? 'bg-emerald-500/15 text-emerald-400' :
                    n.type === 'warning' ? 'bg-amber-500/15 text-amber-500' :
                    'bg-indigo-500/15 text-indigo-500'
                  }`}>
                    <Bell size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{n.text}</p>
                    <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>{n.time}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (n.type === 'success') setTab('appointments');
                      if (n.type === 'warning') setTab('appointments');
                      if (n.type === 'info') setTab('payments');
                    }}
                    className={`${theme === 'dark' ? 'text-indigo-300 hover:text-white' : 'text-indigo-600 hover:text-indigo-800'} text-xs font-semibold`}
                  >
                    Ver
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'lobby' && (
          <div className={`h-full flex overflow-hidden relative ${isDark ? 'bg-slate-950' : 'bg-[#f4f5f7]'}`}>
            <div className="absolute inset-0 pointer-events-none opacity-10" style={{backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(79,70,229,0.08), transparent 35%), radial-gradient(circle at 80% 0%, rgba(99,102,241,0.08), transparent 35%)'}}></div>
            <div className="flex-1 overflow-y-auto relative z-10">
              <div className="max-w-6xl mx-auto px-4 py-6 md:p-8">
                <div className="mb-8">
                  <h1 className={`text-2xl md:text-4xl font-black ${textMain} mb-2`}>
                    Bienvenido, <span className={isDark ? 'text-indigo-300' : 'text-slate-700'}>{clinic.name}</span>
                  </h1>
                  <p className={textSub}>Aquí está lo que está sucediendo hoy</p>
                </div>

                <div className={`rounded-2xl p-4 md:p-5 border mb-6 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className={`${textSub} text-xs`}>Próxima cita</p>
                      <p className={`${textMain} text-xl font-semibold`}>10:00 AM · Hoy</p>
                      <p className={`${textSub} text-sm`}>Paciente nuevo · Limpieza</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className={`px-3 py-2 rounded-xl border text-sm font-semibold transition ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700 shadow-sm'}`}>
                        Confirmar
                      </button>
                      <button className={`px-3 py-2 rounded-xl border text-sm font-semibold transition ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700 shadow-sm'}`}>
                        Reprogramar
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: 'Mensajes sin responder', value: '2' },
                      { label: 'Citas pendientes', value: '3' },
                      { label: 'Ingresos estimados', value: '$1.2k' },
                      { label: 'Auto modo', value: autoMode ? 'On' : 'Off' }
                    ].map((item) => (
                      <div key={item.label} className={`rounded-lg px-3 py-2 border ${isDark ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                        <p className="text-[11px]">{item.label}</p>
                        <p className="text-sm font-semibold">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-4 md:gap-6 mb-8">
                  <div className={`lg:col-span-2 rounded-2xl p-5 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-xl font-semibold ${textMain}`}>Actualizaciones</h2>
            <div className={`${textSub} text-xs`}>4 nuevas</div>
          </div>
                    <div className="space-y-2.5">
                      {[
                        { icon: Calendar, text: 'Juan Pérez', desc: 'Consulta general', count: '1', action: 'appointments' },
                        { icon: CheckCircle, text: 'María López', desc: 'Revisión completada', count: '✓', action: 'appointments' },
                        { icon: MessageCircle, text: 'Carlos Rodríguez', desc: 'Preguntó sobre horarios', count: '2', action: 'messages' },
                        { icon: DollarSign, text: 'Ana García', desc: '$150 procesado', count: '✓', action: 'payments' }
                      ].map((notif, i) => (
                        <div key={i} onClick={() => setTab(notif.action)} className={`rounded-xl p-3 border cursor-pointer transition ${isDark ? 'border-slate-800 hover:border-slate-700' : 'border-slate-200 hover:border-slate-300'}`}>
                          <div className="flex items-center gap-3">
                            <div className={`${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'} w-9 h-9 rounded-lg flex items-center justify-center`}>
                              <notif.icon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`${textMain} text-sm font-semibold`}>{notif.text}</p>
                              <p className={`${textSub} text-xs truncate`}>{notif.desc}</p>
                            </div>
                            <div className={`${isDark ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'} min-w-[24px] h-6 rounded-full border text-xs font-bold flex items-center justify-center`}>
                              {notif.count}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {isMobile && (
                      <button
                        onClick={() => setShowAllLobbyNotifications(!showAllLobbyNotifications)}
                        className={`w-full mt-3 py-3 rounded-xl border text-sm font-semibold ${isDark ? 'border-slate-800 text-white' : 'border-slate-200 text-slate-800'}`}
                      >
                        {showAllLobbyNotifications ? 'Ver menos' : 'Ver más'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className={`rounded-2xl p-5 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className={`${textSub} text-xs`}>Citas hoy</p>
                        <p className={`${textMain} text-3xl font-black`}>24</p>
                      </div>
                      <div className={`${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'} w-10 h-10 rounded-xl flex items-center justify-center`}>
                        <Calendar size={20} />
                      </div>
                    </div>
                    <p className={`${textSub} text-sm`}>Nadie sin confirmar • SLAs en verde</p>
                  </div>
                  <div className={`rounded-2xl p-5 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className={`${textSub} text-xs`}>Mensajes nuevos</p>
                        <p className={`${textMain} text-3xl font-black`}>6</p>
                      </div>
                      <div className={`${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'} w-10 h-10 rounded-xl flex items-center justify-center`}>
                        <MessageCircle size={20} />
                      </div>
                    </div>
                    <p className={`${textSub} text-sm`}>Automático activo • 0 SLA vencidos</p>
                  </div>
                  <div className={`rounded-2xl p-5 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className={`${textSub} text-xs`}>Ingresos estimados</p>
                        <p className={`${textMain} text-3xl font-black`}>$8.5k</p>
                      </div>
                      <div className={`${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-800'} w-10 h-10 rounded-xl flex items-center justify-center`}>
                        <DollarSign size={20} />
                      </div>
                    </div>
                    <p className={`${textSub} text-sm`}>Pagos en línea activados</p>
                  </div>
                </div>

                <div className="mt-6 grid lg:grid-cols-2 gap-4">
                    <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-sm font-semibold ${textMain}`}>
                            Modo automático
                          </p>
                          <p className={`text-xs ${textSub}`}>
                            Respuestas y recordatorios en automático. Cambia a manual cuando quieras.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full border ${
                            isDark ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>{autoMode ? 'On' : 'Off'}</span>
                          <button
                            className={`text-xs px-3 py-1.5 rounded-lg border ${
                              isDark ? 'border-slate-700 text-slate-200 bg-slate-800' : 'border-slate-200 text-slate-700 bg-white shadow-sm'
                            }`}
                            onClick={() => persistAutoMode(!autoMode)}
                          >
                            Tomar control manual
                          </button>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-2 text-xs">
                        {[
                          { label: 'Responder leads', status: autoMode ? 'Auto' : 'Manual' },
                          { label: 'Confirmar cita', status: autoMode ? 'Auto' : 'Manual' },
                          { label: 'Recordar pago', status: autoMode ? 'Auto' : 'Manual' }
                        ].map((item) => (
                          <div
                            key={item.label}
                            className={`rounded-xl px-3 py-2 border ${
                              isDark ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          >
                            <p className="font-semibold">{item.label}</p>
                            <p className={`${isDark ? 'text-slate-300' : 'text-slate-600'} font-semibold`}>{item.status}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                  <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-sm font-semibold ${textMain}`}>
                          Integraciones CRM y canales
                        </p>
                        <p className={`text-xs ${textSub}`}>
                          Conecta tu CRM o usa Supabase como HUB de datos.
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border ${
                        theme === 'dark' ? 'bg-sky-500/10 text-sky-200 border-sky-500/30' : 'bg-sky-50 text-sky-700 border-sky-200'
                      }`}>Sincronizado</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2 text-xs">
                      {[
                        { name: 'WhatsApp Automático', status: 'Conectado' },
                        { name: 'Google Calendar', status: 'Conectado' },
                        { name: 'Stripe', status: 'Conectado' },
                        { name: 'CRM externo', status: 'Pendiente' }
                      ].map((item) => (
                        <div
                          key={item.name}
                          className={`rounded-xl px-3 py-2 border ${
                            isDark ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'
                          } flex items-center justify-between`}
                        >
                          <span>{item.name}</span>
                          <span className={item.status === 'Conectado'
                            ? `${isDark ? 'text-slate-300' : 'text-slate-600'} font-semibold`
                            : `${isDark ? 'text-slate-400' : 'text-slate-500'} font-semibold`
                          }>
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      className={`w-full text-sm font-semibold rounded-xl px-3 py-2 transition ${
                        theme === 'dark'
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                      }`}
                    >
                      Conectar con CRM / API
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right sidebar for desktop - keep as is */}
          </div>
        )}

        {tab === 'messages' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-gray-950' : 'bg-slate-50'}`}>
            <div className="h-full">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 md:gap-4 h-full px-0 md:px-4">
                {/* LISTA DE CONVERSACIONES */}
                <div className={`${selected && isMobile ? 'hidden' : ''} lg:col-span-4 ${isDark ? 'bg-slate-900' : 'bg-white'} ${isMobile ? '' : 'rounded-xl my-4'} overflow-hidden flex flex-col ${isMobile ? '' : isDark ? 'border border-slate-800 shadow-xl' : 'border border-slate-200 shadow-sm'}`} style={{height: isMobile ? 'calc(100vh - 9rem)' : 'calc(100vh - 120px)'}}>
                  <div className={`p-3 md:p-4 border-b ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className={`text-base md:text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Conversaciones</h2>
                      <button className={`p-1.5 rounded-lg transition ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                        <Filter size={16} className={isDark ? 'text-slate-400' : 'text-slate-500'} />
                      </button>
                    </div>
                    <div className="relative">
                      <Search size={15} className={`absolute left-3 top-1/2 transform -translate-y-1/2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                      <input
                        type="text"
                        placeholder="Buscar conversaciones..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={`w-full pl-9 pr-3 py-2 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm transition ${
                          isDark ? 'bg-slate-800 border border-slate-700 text-white placeholder-slate-400' : 'bg-white border border-slate-300 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {loadingChats && (
                      <div className={`p-3 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Cargando conversaciones...</div>
                    )}
                    {filteredChats.map(chat => (
                      <div key={chat.id} className={`relative group transition-all duration-200 ${selected?.id === chat.id ? (isDark ? 'bg-slate-800 border-l-[3px] border-l-indigo-500' : 'bg-slate-100 border-l-[3px] border-l-indigo-500') : isDark ? 'border-b border-slate-800 hover:bg-slate-800' : 'border-b border-slate-200 hover:bg-slate-50'}`}>
                        {editingChat === chat.id ? (
                          <div className="p-3 flex items-center gap-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className={`flex-1 px-3 py-2 rounded-lg text-sm ${isDark ? 'bg-slate-700 border border-slate-600 text-white' : 'bg-white border border-slate-300 text-slate-900'}`}
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                setChats(chats.map(c => c.id === chat.id ? {...c, name: editName} : c));
                                setEditingChat(null);
                              }}
                              className={`p-2 rounded-lg transition ${isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'}`}
                            >
                              <CheckCircle size={16} className="text-white" />
                            </button>
                            <button
                              onClick={() => setEditingChat(null)}
                              className={`p-2 rounded-lg transition ${isDark ? 'bg-slate-600 hover:bg-slate-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                            >
                              <X size={16} className="text-white" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setSelected(chat); loadMessages(chat.id).catch(() => {}); }} className="w-full p-3 text-left relative">
                            <div className="flex items-center gap-3">
                              <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${getAvatarColor(chat.id)} flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md`}>
                                {chat.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                  <p className={`font-semibold truncate text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>{chat.name}</p>
                                  <span className={`text-xs ml-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{chat.time}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <p className={`text-xs truncate pr-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{chat.msg}</p>
                                  {chat.unread > 0 && (
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center flex-shrink-0 shadow-md ${isDark ? 'bg-red-500 text-white' : 'bg-red-100 text-red-700'}`}>
                                      {chat.unread}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingChat(chat.id);
                                setEditName(chat.name);
                              }}
                              className={`absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition ${isDark ? 'bg-slate-700/80 hover:bg-slate-600' : 'bg-slate-100 hover:bg-slate-200'}`}
                            >
                              <Edit2 size={13} className="text-white" />
                            </button>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* CHAT WINDOW */}
                {selected ? (
                  <div className={`${isMobile ? 'col-span-1' : 'lg:col-span-8 my-4'} ${isMobile ? '' : 'rounded-xl'} overflow-hidden flex flex-col ${isMobile ? '' : isDark ? 'border border-slate-200/40' : 'border border-slate-200'}`} style={{height: isMobile ? 'calc(100vh - 9rem)' : 'calc(100vh - 120px)'}}>
                    <div className={`${isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'} px-3 md:px-4 py-2 md:py-3 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} flex items-center gap-3`}>
                      {isMobile && (
                        <button onClick={() => setSelected(null)} className="p-1 hover:bg-slate-100 rounded-full">
                          <X size={20} className="text-slate-600" />
                        </button>
                      )}
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(selected.id)} flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md`}>
                        {selected.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-sm md:text-base font-semibold leading-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{selected.name}</h3>
                        <p className={`text-xs leading-tight ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>en línea</p>
                      </div>
                      <button
                        onClick={() => setAutoMode(!autoMode)}
                        className={`text-xs px-3 py-1.5 rounded-lg border ${
                          autoMode
                            ? isDark ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10' : 'border-emerald-200 text-emerald-700 bg-emerald-50'
                            : isDark ? 'border-amber-500/40 text-amber-200 bg-amber-500/10' : 'border-amber-200 text-amber-700 bg-amber-50'
                        }`}
                      >
                        {autoMode ? 'Auto' : 'Manual'}
                      </button>
                    </div>
                    <div className={`flex-1 overflow-y-auto p-3 md:p-4 space-y-2 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
                      {msgs.map((m, i) => (
                        <div key={i} className={`flex ${m.from === 'user' ? 'justify-start' : 'justify-end'}`}>
                          <div className={`relative max-w-[75%] md:max-w-sm px-3 py-2 shadow-sm ${
                            m.from === 'user'
                              ? `${isDark ? 'bg-slate-800 border border-slate-700 text-white' : 'bg-white border border-slate-200 text-slate-900'} rounded-r-lg rounded-tl-lg`
                              : `${isDark ? 'bg-slate-800 border border-slate-700 text-white' : 'bg-slate-900 text-white'} rounded-l-lg rounded-tr-lg`
                          }`}>
                            <p className="text-xs md:text-sm leading-relaxed">{m.text}</p>
                            <div className="flex items-center justify-end gap-1 mt-1">
                              <span className={`text-xs ${m.from === 'user' ? 'text-slate-500' : 'text-white/80'}`}>{m.time}</span>
                              {m.from !== 'user' && (
                                <Check size={14} className="opacity-80" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className={`px-3 md:px-4 py-2 md:py-3 border-t flex items-center gap-2 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                      <input
                        type="text"
                        placeholder="Escribe un mensaje"
                        value={messageDraft}
                        onChange={(e) => setMessageDraft(e.target.value)}
                        className={`flex-1 px-4 py-2 rounded-full focus:outline-none focus:ring-2 text-sm transition ${
                          isDark ? 'bg-slate-800 border border-slate-700 text-white placeholder-slate-400 focus:ring-slate-600/50 focus:border-slate-600' : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:ring-slate-900/30 focus:border-slate-900'
                        }`}
                        style={{fontSize: '16px'}}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendMessage(); } }}
                      />
                      <button
                        onClick={handleSendMessage}
                        className="w-10 h-10 bg-gradient-to-br from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white rounded-full transition flex items-center justify-center flex-shrink-0 shadow-md"
                      >
                        <Send size={18} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`${isMobile ? 'hidden' : 'lg:col-span-8 my-4'} ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'} rounded-xl flex items-center justify-center`} style={{height: 'calc(100vh - 120px)'}}>
                    <div className="text-center px-4">
                      <MessageCircle size={64} className="mx-auto mb-4 text-slate-300" />
                      <p className={`${isDark ? 'text-slate-200' : 'text-slate-700'} font-semibold text-base mb-1`}>Selecciona una conversación</p>
                      <p className={`${isDark ? 'text-slate-500' : 'text-slate-500'} text-sm`}>WhatsApp conectado (sesión QR)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'appointments' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h1 className={`text-2xl md:text-3xl font-black ${textMain}`}>Agenda y calendario</h1>
                  <p className={`${textSub} text-sm`}>Coordina citas, recordatorios y la disponibilidad del equipo</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-teal-500 text-white font-semibold shadow-lg shadow-indigo-500/30 hover:shadow-2xl hover:scale-[1.02] transition">
                    <Plus size={16} /> Nueva cita
                  </button>
                  <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-white border border-slate-700 hover:border-indigo-500/50 transition">
                    <Upload size={16} /> Exportar
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl p-2 w-full">
                <button
                  onClick={() => setAppointmentsView('calendar')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                    appointmentsView === 'calendar' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Calendar size={16} /> Calendario
                </button>
                <button
                  onClick={() => setAppointmentsView('list')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                    appointmentsView === 'list' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText size={16} /> Lista
                </button>
              </div>

              {appointmentsView === 'calendar' ? (
                <div className={`rounded-2xl p-5 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className={`flex items-center gap-2 text-sm ${textSub}`}>
                      <Calendar size={16} />
                      <span>Agenda</span>
                    </div>
                    <div className={`flex items-center gap-2 bg-slate-800/40 rounded-xl p-1 ${!isDark ? 'bg-slate-100' : ''}`}>
                      {['dia','semana','mes','año'].map((m) => (
                        <button
                          key={m}
                          onClick={() => setCalendarMode(m as typeof calendarMode)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                            calendarMode === m
                              ? isDark ? 'bg-slate-800 text-white' : 'bg-white text-slate-900 shadow-sm'
                              : isDark ? 'text-slate-400' : 'text-slate-500'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {calendarMode === 'semana' && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                      {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((day, idx) => (
                        <div key={day} className={`rounded-xl border p-3 space-y-2 ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className={textSub}>{day}</span>
                            <span className={textSub}>{15 + idx} Dic</span>
                          </div>
                          <div className="space-y-1.5">
                            {schedule
                              .filter((appt) => appt.id % 7 === idx % 7)
                              .slice(0,2)
                              .map((appt) => (
                                <div key={appt.id} className={`rounded-lg border px-2 py-1 text-xs ${isDark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-slate-200 bg-white text-slate-800'}`}>
                                  <p className="font-semibold">{appt.time}</p>
                                  <p className={`${textSub} truncate`}>{appt.name} · {appt.service}</p>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {calendarMode === 'dia' && (
                    <div className="space-y-2">
                      {schedule.map((appt) => (
                        <div key={appt.id} className={`rounded-xl border p-3 flex items-center gap-3 ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                          <div className={`${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'} w-10 h-10 rounded-lg flex items-center justify-center font-semibold`}>
                            {appt.time}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`${textMain} font-semibold text-sm`}>{appt.name}</p>
                            <p className={`${textSub} text-xs truncate`}>{appt.service} · {appt.channel}</p>
                          </div>
                          <span className={`${textSub} text-xs`}>{appt.status}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {calendarMode === 'mes' && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                      {[...Array(28)].map((_, i) => (
                        <div key={i} className={`h-20 rounded-lg border p-2 flex flex-col ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                          <div className="flex items-center justify-between">
                            <span className={textSub}>{i + 1} Dic</span>
                          </div>
                          <div className="mt-1 space-y-1 overflow-hidden">
                            {schedule.filter((s) => s.id % 7 === i % 7).slice(0,1).map((s) => (
                              <div key={s.id} className={`rounded px-2 py-1 border ${isDark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                {s.name}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {calendarMode === 'año' && (
                    <div className={`rounded-xl border p-6 text-center ${isDark ? 'border-slate-800 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>
                      Vista anual compacta. Próximos hitos: campañas de higiene Q1, ortodoncia Q2.
                    </div>
                  )}
                </div>
              ) : (
                <div className={`rounded-2xl overflow-hidden border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="grid grid-cols-5 px-4 py-3 text-xs font-semibold text-slate-400 border-b border-slate-800">
                    <span>Paciente</span>
                    <span>Servicio</span>
                    <span>Fecha</span>
                    <span>Estado</span>
                    <span className="text-right">Canal</span>
                  </div>
                  <div className="divide-y divide-slate-800">
                    {schedule.map((item) => (
                      <div key={item.id} className="grid grid-cols-5 px-4 py-4 text-sm text-slate-200 hover:bg-slate-800/60 transition">
                        <div className="flex items-center gap-2">
                          <User size={16} className="text-indigo-300" />
                          <span>{item.name}</span>
                        </div>
                        <span className="text-slate-300">{item.service}</span>
                        <span className="text-slate-400">{item.date} · {item.time}</span>
                        <span className={item.status === 'confirmada' ? 'text-emerald-300' : 'text-amber-300'}>{item.status}</span>
                        <span className="text-right text-slate-400">{item.channel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'patients' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h1 className={`text-2xl md:text-3xl font-black ${textMain}`}>Pacientes</h1>
                  <p className={`${textSub} text-sm`}>Historial, contacto y notas rápidas</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 flex items-center gap-2">
                    <Filter size={15} /> Filtros
                  </button>
                  <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-indigo-500 text-white font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/30">
                    <Plus size={16} /> Nuevo paciente
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {patients.map((patient, idx) => (
                  <div key={idx} className={`rounded-2xl p-4 flex flex-col gap-3 transition border ${isDark ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'} font-bold flex items-center justify-center`}>
                          {patient.name.charAt(0)}
                        </div>
                        <div>
                          <p className={`${textMain} font-semibold`}>{patient.name}</p>
                          <p className={`${textSub} text-xs`}>{patient.status === 'nuevo' ? 'Nuevo' : 'Seguimiento'} · {patient.lastVisit}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}>
                        {patient.status}
                      </span>
                    </div>
                    <div className={`flex items-center gap-3 text-sm ${isDark ? 'text-slate-100' : 'text-slate-700'}`}>
                      <Phone size={14} className={isDark ? 'text-slate-300' : 'text-slate-500'} />
                      <span>{patient.phone}</span>
                      <MapPin size={14} className={`${isDark ? 'text-slate-300' : 'text-slate-500'} ml-2`} />
                      <span>{patient.location}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className={`flex items-center gap-2 ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                        <Info size={14} />
                        <span>{patient.notes}</span>
                      </div>
                      <button className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}>
                        Enviar recordatorio
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'payments' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h1 className={`text-2xl md:text-3xl font-black ${textMain}`}>Pagos y facturación</h1>
                  <p className={`${textSub} text-sm`}>Recaudación, métodos y estados de cobro</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 flex items-center gap-2">
                    <Upload size={15} /> Exportar CSV
                  </button>
                  <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold flex items-center gap-2 shadow-lg shadow-emerald-500/30">
                    <DollarSign size={16} /> Cobro rápido
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-4 gap-3">
                {[
                  { label: 'Ingresos del mes', value: '$12,400', change: '+14%' },
                  { label: 'Pendientes', value: '$540', change: '-6%' },
                  { label: 'Ticket promedio', value: '$148', change: '+3%' },
                  { label: 'Pagos en línea', value: '74%', change: '+9%' }
                ].map((card, idx) => (
                  <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                    <p className="text-slate-400 text-xs">{card.label}</p>
                    <p className="text-white text-2xl font-black mt-1">{card.value}</p>
                    <p className="text-emerald-300 text-xs font-semibold">{card.change} vs mes anterior</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="grid grid-cols-5 px-4 py-3 text-xs font-semibold text-slate-400 border-b border-slate-800">
                  <span>Paciente</span>
                  <span>Monto</span>
                  <span>Estado</span>
                  <span>Método</span>
                  <span className="text-right">Fecha</span>
                </div>
                <div className="divide-y divide-slate-800">
                  {paymentHistory.map((pay) => (
                    <div key={pay.id} className="grid grid-cols-5 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/60 transition">
                      <span className="flex items-center gap-2">
                        <User size={15} className="text-indigo-300" />
                        {pay.patient}
                      </span>
                      <span className="text-white font-semibold">${pay.amount}</span>
                      <span className="text-xs px-2 py-1 rounded-full border justify-self-start bg-slate-800 text-slate-200 border-slate-700">
                        {pay.status}
                      </span>
                      <span className="text-slate-300">{pay.method}</span>
                      <span className="text-right text-slate-400">{pay.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h1 className={`text-2xl md:text-3xl font-black ${textMain}`}>Reportes</h1>
                  <p className={`${textSub} text-sm`}>Descarga PDF o comparte con dirección</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 flex items-center gap-2">
                    <FileText size={15} /> Generar PDF
                  </button>
                  <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 text-white font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/30">
                    <Upload size={16} /> Compartir
                  </button>
                </div>
              </div>

                    <div className="grid md:grid-cols-4 gap-3">
                      {reportCards.map((card, idx) => (
                        <div key={idx} className={`rounded-2xl p-4 space-y-2 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                            <card.icon size={18} />
                          </div>
                          <p className={`${textSub} text-xs`}>{card.title}</p>
                          <p className={`${textMain} text-2xl font-black`}>{card.value}</p>
                          <p className={`${isDark ? 'text-slate-300' : 'text-slate-600'} text-xs font-semibold`}>{card.change} vs mes anterior</p>
                        </div>
                      ))}
                    </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-white font-semibold">Resumen ejecutivo</p>
                  <Zap size={16} className="text-amber-300" />
                </div>
                <div className="grid md:grid-cols-3 gap-4 text-sm text-slate-300">
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700">
                    <p className="text-white font-semibold">Productividad</p>
                    <p className="text-slate-400 text-sm mt-1">Tiempo promedio de respuesta de 6m y ocupación al 82%.</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700">
                    <p className="text-white font-semibold">Finanzas</p>
                    <p className="text-slate-400 text-sm mt-1">Ticket promedio estable y 74% de pagos digitales.</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700">
                    <p className="text-white font-semibold">Pacientes</p>
                    <p className="text-slate-400 text-sm mt-1">18 nuevos este mes. Mayor origen: WhatsApp.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'analytics' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h1 className={`text-2xl md:text-3xl font-black ${textMain}`}>Analítica</h1>
                  <p className={`${textSub} text-sm`}>Rendimiento en tiempo real</p>
                </div>
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-1">
                  {['overview', 'conversion'].map((item) => (
                    <button
                      key={item}
                      onClick={() => setDashboardTab(item)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                        dashboardTab === item ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

                <div className="grid md:grid-cols-4 gap-3">
                  {[
                    { label: 'Mensajes', value: liveStats.messages, icon: MessageCircle },
                    { label: 'Citas activas', value: liveStats.appointments, icon: Calendar },
                    { label: 'Pacientes activos', value: liveStats.activePatients, icon: Users },
                    { label: 'Tasa respuesta', value: `${liveStats.responseRate.toFixed(1)}%`, icon: TrendingUp }
                  ].map((stat, idx) => (
                    <div key={idx} className={`rounded-2xl p-4 space-y-2 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                        <stat.icon size={18} />
                      </div>
                      <p className={`${textSub} text-xs`}>{stat.label}</p>
                      <p className={`${textMain} text-2xl font-black`}>{stat.value}</p>
                      <p className={`${isDark ? 'text-slate-400' : 'text-slate-500'} text-xs font-semibold`}>Tiempo real</p>
                    </div>
                  ))}
                </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-white font-semibold">Ocupación por franja</p>
                    <Clock size={16} className="text-slate-400" />
                  </div>
                  <div className="space-y-2">
                    {timeSlotsPercent.map((value, idx) => (
                      <div key={idx} className="flex items-center gap-3">
                        <span className="w-14 text-xs text-slate-400">{['9 AM', '12 PM', '3 PM', '6 PM'][idx]}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-teal-500" style={{width: `${value}%`}}></div>
                        </div>
                        <span className="text-xs text-slate-300">{value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-white font-semibold">Satisfacción</p>
                    <Smile size={16} className="text-amber-300" />
                  </div>
                  <div className="relative">
                    <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full" style={{width: `${satisfactionPercent}%`}}></div>
                    </div>
                    <p className="text-white font-semibold mt-2">{satisfactionPercent}%</p>
                    <p className="text-slate-400 text-xs">Feedback promedio de los últimos 30 días</p>
                  </div>
                </div>
              </div>

              {dashboardTab === 'conversion' && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-white font-semibold">Embudo de conversión</p>
                    <TrendingUp size={16} className="text-emerald-300" />
                  </div>
                  <div className="grid md:grid-cols-4 gap-3">
                    {[
                      { label: 'Nuevos leads', value: 72, rate: '100%' },
                      { label: 'Conversaciones', value: 58, rate: '81%' },
                      { label: 'Agendados', value: 36, rate: '62%' },
                      { label: 'Asistieron', value: 31, rate: '52%' }
                    ].map((step, idx) => (
                      <div key={idx} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3">
                        <p className="text-slate-400 text-xs">{step.label}</p>
                        <p className="text-white text-xl font-black mt-1">{step.value}</p>
                        <p className="text-emerald-300 text-xs font-semibold">{step.rate} conversión</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
            <div className="max-w-5xl mx-auto px-4 py-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h1 className={`text-2xl md:text-3xl font-black ${textMain}`}>Configuración</h1>
                  <p className={`${textSub} text-sm`}>Ajusta tu clínica, notificaciones e integraciones</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-1 flex items-center gap-1">
                  {[
                    { id: 'general', label: 'General' },
                    { id: 'notifications', label: 'Alertas' },
                    { id: 'integrations', label: 'Integraciones' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSettingsTab(item.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        settingsTab === item.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {settingsTab === 'general' && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <p className="text-white font-semibold">Perfil de la clínica</p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-400">Nombre</label>
                      <input
                        value={clinic.name}
                        onChange={(e) => setClinic({...clinic, name: e.target.value})}
                        className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Teléfono</label>
                      <input
                        value={clinic.phone}
                        onChange={(e) => setClinic({...clinic, phone: e.target.value})}
                        className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-slate-300 text-sm">
                      <Upload size={14} />
                      <span>Sube tu logo para personalizar la app</span>
                    </div>
                    <button className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 text-xs font-semibold">
                      Cargar
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'notifications' && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Bell size={16} className="text-amber-300" />
                    <p className="text-white font-semibold">Alertas inteligentes</p>
                  </div>
                  <div className="space-y-3">
                    {['Citas nuevas', 'Pagos recibidos', 'Pacientes sin responder'].map((label, idx) => (
                      <label key={idx} className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200">
                        <span>{label}</span>
                        <input type="checkbox" defaultChecked className="accent-indigo-500 w-4 h-4" />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {settingsTab === 'integrations' && (
                <div className={`rounded-2xl p-5 space-y-3 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <p className={`${isDark ? 'text-white' : 'text-slate-900'} font-semibold`}>Integraciones</p>
                  <div className="space-y-2">
                    {integrations.map((item, idx) => (
                      <div key={idx} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? 'bg-slate-900 border border-slate-700' : 'bg-white border border-slate-200'}`}>
                            <item.icon size={16} className={isDark ? 'text-indigo-300' : 'text-indigo-500'} />
                          </div>
                          <div>
                            <p className={`${isDark ? 'text-white' : 'text-slate-900'} font-semibold text-sm`}>{item.name}</p>
                            <p className={`${isDark ? 'text-slate-400' : 'text-slate-500'} text-xs`}>{item.detail}</p>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full border ${item.status === 'activo' || item.status === 'sincronizado' ? (isDark ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' : 'bg-emerald-50 text-emerald-700 border-emerald-200') : (isDark ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : 'bg-amber-50 text-amber-700 border-amber-200')}`}>
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* WhatsApp QR connect */}
                  <div className={`mt-3 rounded-2xl p-4 border ${isDark ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className={`${isDark ? 'text-white' : 'text-slate-900'} font-semibold text-sm`}>Conectar WhatsApp (QR)</p>
                        <p className={`${isDark ? 'text-slate-400' : 'text-slate-600'} text-xs`}>Escanea el QR para iniciar sesión de tu línea.</p>
                      </div>
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">Generar QR</button>
                    </div>
                    <div className={`h-32 rounded-xl border flex items-center justify-center ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-300 bg-white'}`}>
                      <span className={`${isDark ? 'text-slate-500' : 'text-slate-400'} text-xs`}>QR de WhatsApp aquí</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Notificaciones móviles ya están en la top bar */}

      {/* BOTTOM NAVBAR MÓVIL - CON SAFE AREA */}
      {isMobile && (
        <div 
          className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 z-50 shadow-2xl" 
          style={{paddingBottom: 'env(safe-area-inset-bottom)'}}
        >
          <div className="flex items-center justify-around px-1 py-1.5">
            {[
              { id: 'lobby', icon: Home },
              { id: 'messages', icon: MessageCircle, badge: 6 },
              { id: 'appointments', icon: Calendar, badge: 3 },
              { id: 'payments', icon: DollarSign },
              { id: 'analytics', icon: BarChart3 },
              { id: 'settings', icon: Settings }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`relative flex flex-col items-center justify-center px-2 py-2.5 rounded-xl transition-all ${
                  tab === item.id
                    ? 'text-indigo-500 border border-indigo-500/40 bg-transparent'
                    : 'text-slate-400 border border-transparent'
                }`}
              >
                <item.icon
                  size={20}
                  className="mb-0.5"
                  strokeWidth={2.5}
                  fill="none"
                />
                {item.badge && <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-md">{item.badge}</span>}
              </button>
            ))}
          </div>
          <div className="py-1.5 bg-slate-950 border-t border-slate-800">
            <p className="text-center text-slate-500 text-[10px] font-medium">
              Powered by <span className="font-bold text-[#00D9FF]">CREATYV.IO</span>
            </p>
          </div>
        </div>
      )}

      {/* FOOTER DESKTOP */}
      {!isMobile && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 py-2 px-6 z-30 ml-64">
          <p className="text-center text-slate-500 text-xs font-medium">
            Powered by <span className="font-bold text-[#00D9FF]">CREATYV.IO</span>
          </p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <RootApp />
    </ErrorBoundary>
  );
}
