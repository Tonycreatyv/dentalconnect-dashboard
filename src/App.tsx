import React, { useState, useEffect, Component, ReactNode } from 'react';
import { MessageCircle, Calendar, BarChart3, Settings, LogOut, Menu, X, Send, Plus, CreditCard as Edit2, Search, Filter, Bell, User, Clock, TrendingUp, Users, CheckCircle, Home, FileText, DollarSign, AlertCircle, Phone, Upload, MapPin, Info, Check, Zap, Smile } from 'lucide-react';

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
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [autoMode, setAutoMode] = useState(true);
  const [selected, setSelected] = useState<{id: number; name: string; msg: string; time: string; unread: number} | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [editingChat, setEditingChat] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
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

  const [chats, setChats] = useState([
    { id: 1, name: 'Juan Pérez', msg: 'Quiero agendar cita', time: '5m', unread: 2 },
    { id: 2, name: 'María López', msg: 'Gracias por la info', time: '30m', unread: 0 },
    { id: 3, name: 'Carlos Rodríguez', msg: '¿Cuál es el costo?', time: '1h', unread: 1 },
    { id: 4, name: 'Ana García', msg: 'Confirmo mi cita', time: '2h', unread: 0 }
  ]);

  const notifications = [
    { id: 1, text: 'Nueva cita agendada', time: '5m', type: 'success' },
    { id: 2, text: 'Recordatorio: Cita en 30 min', time: '15m', type: 'warning' },
    { id: 3, text: 'Pago recibido de Juan Pérez', time: '1h', type: 'info' }
  ];

  const schedule = [
    { id: 1, name: 'Juan Pérez', service: 'Limpieza', date: 'Hoy', time: '10:00 AM', status: 'confirmada', channel: 'WhatsApp' },
    { id: 2, name: 'María López', service: 'Consulta', date: 'Hoy', time: '2:00 PM', status: 'confirmada', channel: 'Web' },
    { id: 3, name: 'Ana García', service: 'Extracción', date: 'Mañana', time: '9:30 AM', status: 'pendiente', channel: 'Teléfono' },
    { id: 4, name: 'Luis Gómez', service: 'Revisión', date: 'Mañana', time: '3:00 PM', status: 'pendiente', channel: 'WhatsApp' }
  ];

  const patients = [
    { name: 'Juan Pérez', status: 'activo', phone: '555-0123', lastVisit: 'Hace 2 días', location: 'Tegucigalpa', notes: 'Interesado en blanqueamiento' },
    { name: 'María López', status: 'nuevo', phone: '555-0124', lastVisit: 'Hoy', location: 'San Pedro Sula', notes: 'Prefiere mañana' },
    { name: 'Carlos Rodríguez', status: 'pendiente', phone: '555-0125', lastVisit: 'Hace 1 semana', location: 'Tegucigalpa', notes: 'Falta confirmar pago' },
    { name: 'Ana García', status: 'activo', phone: '555-0126', lastVisit: 'Hace 3 días', location: 'El Progreso', notes: 'Solicitó radiografía' },
    { name: 'Roberto Martínez', status: 'inactivo', phone: '555-0127', lastVisit: 'Hace 2 meses', location: 'Tocoa', notes: 'Enviar recordatorio' }
  ];

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

  const getAvatarColor = (id: number) => avatarColors[id % avatarColors.length];

  const filteredChats = chats.filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.msg.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const msgs = selected ? [
    { from: 'user', text: '¿Cuándo puedo agendar?', time: '10:30' },
    { from: 'bot', text: '¡Hola! ¿Qué servicio necesitas?', time: '10:31' },
    { from: 'user', text: 'Una limpieza dental', time: '10:32' },
    { from: 'bot', text: '¿Mañana a las 2pm?', time: '10:33' }
  ] : [];

  const appts = [
    { name: 'Juan Pérez', service: 'Limpieza', date: '15 Dic', time: '10:00 AM', status: 'confirmada' },
    { name: 'María López', service: 'Consulta', date: '16 Dic', time: '2:00 PM', status: 'confirmada' },
    { name: 'Ana García', service: 'Extracción', date: '17 Dic', time: '9:30 AM', status: 'pendiente' }
  ];

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
            <div className="w-24 h-24 mx-auto rounded-3xl bg-black flex items-center justify-center shadow-xl">
              <img
                src="/creatyv image.png"
                alt="CREATYV Logo"
                className="w-20 h-20 object-contain"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl p-5 backdrop-blur">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white font-semibold text-lg">{loginMode ? 'Iniciar sesión' : 'Crear cuenta'}</p>
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
      {/* TOP BAR MÓVIL - CON SAFE AREA */}
      {isMobile && (
        <div 
          className="fixed top-0 left-0 right-0 flex items-center justify-between px-4 z-50" 
          style={{
            backgroundColor: '#13151a', 
            borderBottom: '1px solid #1e293b',
            paddingTop: 'max(env(safe-area-inset-top), 0.75rem)',
            paddingBottom: '0.75rem',
            height: 'auto'
          }}
        >
          <button onClick={() => setSidebar(!sidebar)} className="p-2 hover:bg-[#1c1f26] rounded-lg transition-all duration-200">
            <Menu size={24} className="text-white" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-teal-500 rounded-lg flex items-center justify-center font-bold text-white text-sm shadow-lg">
              {clinic.name.charAt(0)}
            </div>
            <span className="text-white font-semibold text-sm">{clinic.name}</span>
          </div>
          <div className="w-10"></div>
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
          <button
            onClick={() => {setTab('settings'); if(isMobile) setSidebar(false);}}
            className={`w-full flex items-center gap-3 px-3 py-2.5 md:px-4 md:py-3 rounded-lg transition ${
              tab === 'settings'
                ? 'text-white border-2 border-indigo-500/50 bg-indigo-500/10'
                : 'text-slate-400 hover:text-white border-2 border-transparent transition-all duration-200 hover:bg-[#1c1f26]'
            }`}
          >
            <Settings size={19} strokeWidth={2} />
            <span className="font-semibold text-sm">Configuración</span>
          </button>
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
          paddingTop: 'calc(3.5rem + max(env(safe-area-inset-top), 0.75rem))',
          paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))'
        } : {}}
      >
        <div className="px-4 pt-4 md:px-8 md:pt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            {[
              { label: 'Próxima cita', value: '10:00 AM · Hoy', icon: Clock },
              { label: 'Slots ocupados', value: `${timeSlotsPercent[0]}%`, icon: TrendingUp },
              { label: 'Satisfacción', value: `${satisfactionPercent}%`, icon: CheckCircle }
            ].map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                  theme === 'dark'
                    ? 'border-slate-800 bg-slate-900/80 text-white'
                    : 'border-slate-200 bg-white text-slate-900 shadow-sm'
                }`}
              >
                <item.icon
                  size={16}
                  className={theme === 'dark' ? 'text-sky-300' : 'text-sky-600'}
                />
                <div>
                  <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                    {item.label}
                  </p>
                  <p className="text-sm font-semibold">{item.value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition ${
                theme === 'dark'
                  ? 'border-slate-700 bg-slate-900 text-slate-200 hover:border-sky-400/50'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-sky-400/50 shadow-sm'
              }`}
            >
              {theme === 'dark' ? '🌙 Modo oscuro' : '☀️ Modo claro'}
            </button>
            <button
              onClick={() => setAutoMode(!autoMode)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition ${
                autoMode
                  ? 'border-emerald-500/40 text-emerald-100 bg-emerald-500/10 hover:bg-emerald-500/20'
                  : 'border-amber-500/40 text-amber-100 bg-amber-500/10 hover:bg-amber-500/20'
              }`}
            >
              <Zap size={16} />
              {autoMode ? 'Automático ON' : 'Manual'}
            </button>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition ${
                theme === 'dark'
                  ? 'border-indigo-500/40 text-indigo-100 bg-indigo-500/10 hover:bg-indigo-500/20'
                  : 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
              }`}
            >
              <Bell size={16} />
              <span className="text-sm font-semibold">Centro de notificaciones</span>
            </button>
          </div>
        </div>

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
          <div className={`h-full flex overflow-hidden relative ${isDark ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950' : 'bg-gradient-to-br from-slate-50 via-white to-slate-100'}`}>
            {isDark && (
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-20 left-20 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl"></div>
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl" style={{animationDelay: '1s'}}></div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto relative z-10">
              <div className="max-w-6xl mx-auto px-4 py-6 md:p-8">
                <div className="mb-8">
                  <h1 className="text-2xl md:text-4xl font-black text-white mb-2">
                    Bienvenido, <span className="text-indigo-400">{clinic.name}</span>
                  </h1>
                  <p className="text-slate-400">Aquí está lo que está sucediendo hoy</p>
                </div>

                {/* Continue with lobby content but I'll keep it the same as before for brevity */}
                <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-white">Actualizaciones</h2>
                      <div className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-bold px-3 py-1.5 rounded-full">
                        4 nuevas
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {[
                        { icon: Calendar, text: 'Juan Pérez', desc: 'Consulta general', count: '1', tone: 'accent', action: 'appointments' },
                        { icon: CheckCircle, text: 'María López', desc: 'Revisión completada', count: '✓', tone: 'success', action: 'appointments' },
                        { icon: MessageCircle, text: 'Carlos Rodríguez', desc: 'Preguntó sobre horarios', count: '2', tone: 'info', action: 'messages' },
                        { icon: DollarSign, text: 'Ana García', desc: '$150 procesado', count: '✓', tone: 'success', action: 'payments' },
                        { icon: User, text: 'Roberto Martínez', desc: 'Nuevo registro', count: '1', tone: 'info', action: 'patients' },
                        { icon: AlertCircle, text: 'Pedro Sánchez', desc: 'Cita en 30 min', count: '!', tone: 'warning', action: 'appointments' }
                      ].slice(0, isMobile && !showAllLobbyNotifications ? 3 : 6).map((notif, i) => (
                        <div
                          key={i}
                          onClick={() => setTab(notif.action)}
                          className="group relative cursor-pointer"
                          style={{
                            animation: `slideInLeft 0.5s ease-out ${i * 0.1}s both`
                          }}
                        >
                          <div className="relative backdrop-blur-2xl rounded-full px-4 py-3 border border-white/10 hover:border-white/20 transition-all duration-300 hover:bg-white/10">
                            <div className="flex items-center gap-3.5">
                              <div className={`
                                w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                                ${notif.tone === 'accent' ? 'bg-sky-500/15' : ''}
                                ${notif.tone === 'success' ? 'bg-emerald-500/15' : ''}
                                ${notif.tone === 'info' ? 'bg-indigo-500/15' : ''}
                                ${notif.tone === 'warning' ? 'bg-amber-500/15' : ''}
                                group-hover:scale-110 transition-transform
                              `}>
                                <notif.icon size={16} className={`
                                  ${notif.tone === 'accent' ? 'text-sky-300' : ''}
                                  ${notif.tone === 'success' ? 'text-emerald-300' : ''}
                                  ${notif.tone === 'info' ? 'text-indigo-300' : ''}
                                  ${notif.tone === 'warning' ? 'text-amber-300' : ''}
                                `} strokeWidth={2.5} />
                              </div>

                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-white font-semibold text-sm">{notif.text}</span>
                                <span className="text-slate-400 text-xs truncate">{notif.desc}</span>
                              </div>

                              <div
                                className={`
                                  min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold
                                  ${notif.tone === 'accent' ? 'bg-sky-500 text-white' : ''}
                                  ${notif.tone === 'success' ? 'bg-emerald-500 text-white' : ''}
                                  ${notif.tone === 'info' ? 'bg-indigo-500 text-white' : ''}
                                  ${notif.tone === 'warning' ? 'bg-amber-500 text-white' : ''}
                                `}
                              >
                                {notif.count}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {isMobile && (
                      <button
                        onClick={() => setShowAllLobbyNotifications(!showAllLobbyNotifications)}
                        className="w-full py-3 backdrop-blur-2xl border border-white/10 hover:border-white/20 hover:bg-white/10 text-white font-semibold rounded-full transition-all"
                      >
                        {showAllLobbyNotifications ? 'Ver menos' : 'Ver más actualizaciones'}
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-white">Pacientes</h2>
                      <div className="bg-teal-500 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                        156 total
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {[
                        { name: 'Juan Pérez', status: 'complete', info: '555-0123' },
                        { name: 'María López', status: 'missing-email', info: '555-0124' },
                        { name: 'Carlos Rodríguez', status: 'missing-phone', info: 'carlos@email.com' },
                        { name: 'Ana García', status: 'complete', info: '555-0126' },
                        { name: 'Roberto Martínez', status: 'missing-email', info: '555-0127' },
                        { name: 'Pedro Sánchez', status: 'missing-all', info: 'Sin datos' }
                      ].slice(0, isMobile ? 3 : 6).map((patient, i) => (
                        <div
                          key={i}
                          onClick={() => setTab('patients')}
                          className="group relative cursor-pointer"
                          style={{
                            animation: `slideInRight 0.5s ease-out ${i * 0.1}s both`
                          }}
                        >
                        <div className={`relative backdrop-blur-2xl rounded-full px-4 py-3 border transition-all duration-300 ${
                          isDark ? 'border-white/10 hover:border-white/20 hover:bg-white/10' : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}>
                            <div className="flex items-center gap-3.5">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-sky-500/20 to-indigo-500/20 group-hover:scale-110 transition-transform ${isDark ? '' : 'text-indigo-700'}`}>
                                <span className={`${isDark ? 'text-sky-200' : 'text-indigo-700'} font-bold text-sm`}>{patient.name.charAt(0)}</span>
                              </div>

                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className={`${isDark ? 'text-white' : 'text-slate-900'} font-semibold text-sm`}>{patient.name}</span>
                                <span className={`${isDark ? 'text-slate-400' : 'text-slate-500'} text-xs truncate`}>{patient.info}</span>
                              </div>

                              {patient.status === 'complete' && (
                                <div className={`min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold ${isDark ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                                  ✓
                                </div>
                              )}
                              {patient.status === 'missing-email' && (
                                <div className={`min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold ${isDark ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
                                  @
                                </div>
                              )}
                              {patient.status === 'missing-phone' && (
                                <div className={`min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold ${isDark ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
                                  #
                                </div>
                              )}
                              {patient.status === 'missing-all' && (
                                <div className={`min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold ${isDark ? 'bg-red-500 text-white' : 'bg-red-100 text-red-700'}`}>
                                  !
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => setTab('patients')}
                      className="w-full py-3.5 backdrop-blur-2xl border border-white/10 hover:border-white/20 hover:bg-white/10 text-white font-semibold rounded-full transition-all hover:scale-[1.02]"
                    >
                      Ver todos los pacientes
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { icon: Calendar, label: 'Citas hoy', value: '24', action: 'appointments' },
                    { icon: MessageCircle, label: 'Mensajes', value: '6', action: 'messages' },
                    { icon: Users, label: 'Pacientes', value: '156', action: 'patients' },
                    { icon: DollarSign, label: 'Ingresos', value: '$8.5k', action: 'payments' }
                  ].map((stat, i) => (
                    <button
                      key={i}
                    onClick={() => setTab(stat.action)}
                    className="
                      group bg-gradient-to-br from-slate-800/80 to-slate-900/90 backdrop-blur-xl
                      rounded-2xl p-6 border border-slate-700 hover:border-sky-400/50
                      transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-sky-500/15
                    "
                    style={{ backgroundColor: 'rgba(21, 24, 32, 0.9)' }}
                  >
                    <div
                      className="
                        w-12 h-12 bg-gradient-to-br from-sky-500 to-indigo-600
                        rounded-xl flex items-center justify-center mb-3 mx-auto
                        group-hover:scale-105 transition-transform shadow-lg shadow-sky-500/30
                      "
                    >
                        <stat.icon size={24} className="text-white" strokeWidth={2.5} />
                      </div>
                      <p className="text-3xl font-black text-white mb-1">{stat.value}</p>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                    </button>
                  ))}
                </div>

                <div className="mt-6 grid lg:grid-cols-2 gap-4">
                  <div
                    className={`rounded-2xl border p-4 space-y-3 ${
                      theme === 'dark'
                        ? 'bg-slate-900/90 border-slate-800'
                        : 'bg-white border-slate-200 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                          Modo automático (n8n)
                        </p>
                        <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                          Respuestas, recordatorios y confirmaciones vía WhatsApp + n8n.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full border ${
                          theme === 'dark' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>On</span>
                        <button
                          className={`text-xs px-3 py-1.5 rounded-lg border ${
                            theme === 'dark' ? 'border-slate-700 text-slate-200 bg-slate-800' : 'border-slate-200 text-slate-700 bg-white shadow-sm'
                          }`}
                        >
                          Tomar control manual
                        </button>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-2 text-xs">
                      {[
                        { label: 'Responder leads', status: 'Automático' },
                        { label: 'Confirmar cita', status: 'Automático' },
                        { label: 'Recordar pago', status: 'Manual' }
                      ].map((item) => (
                        <div
                          key={item.label}
                          className={`rounded-xl px-3 py-2 border ${
                            theme === 'dark' ? 'border-slate-800 bg-slate-800/60 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          <p className="font-semibold">{item.label}</p>
                          <p className={`${theme === 'dark' ? 'text-sky-300' : 'text-sky-700'} font-semibold`}>{item.status}</p>
                        </div>
                      ))}
                    </div>
                    <div className={`rounded-xl p-3 border text-xs ${theme === 'dark' ? 'border-slate-800 bg-slate-800/60 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                      Flujo: WhatsApp (QR) ➜ n8n (webhook) ➜ Supabase (paciente + cita) ➜ WhatsApp (confirmación) ➜ Google Calendar. Ajusta pasos desde n8n.
                    </div>
                  </div>

                  <div
                    className={`rounded-2xl border p-4 space-y-3 ${
                      theme === 'dark'
                        ? 'bg-slate-900/90 border-slate-800'
                        : 'bg-white border-slate-200 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                          Integraciones CRM y canales
                        </p>
                        <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
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
                            theme === 'dark' ? 'border-slate-800 bg-slate-800/60 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'
                          } flex items-center justify-between`}
                        >
                          <span>{item.name}</span>
                          <span className={item.status === 'Conectado'
                            ? `${theme === 'dark' ? 'text-emerald-300' : 'text-emerald-700'} font-semibold`
                            : `${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'} font-semibold`
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
                          <button onClick={() => setSelected(chat)} className="w-full p-3 text-left relative">
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
                        <h3 className={`text-sm md:text-base font-semibold leading-tight ${isDark ? 'text-white' : ''}`}>{selected.name}</h3>
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
                              : 'bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-l-lg rounded-tr-lg'
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
                        className={`flex-1 px-4 py-2 rounded-full focus:outline-none focus:ring-2 text-sm transition ${
                          isDark ? 'bg-slate-800 border border-slate-700 text-white placeholder-slate-400 focus:ring-slate-600/50 focus:border-slate-600' : 'bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:ring-slate-900/30 focus:border-slate-900'
                        }`}
                        style={{fontSize: '16px'}}
                      />
                      <button className="w-10 h-10 bg-gradient-to-br from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white rounded-full transition flex items-center justify-center flex-shrink-0 shadow-md">
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
                <div className="grid lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 space-y-3">
                    {schedule.map((item) => (
                      <div key={item.id} className={`rounded-2xl p-4 flex items-center gap-4 hover:border-indigo-500/40 transition border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/30 to-teal-500/30 flex items-center justify-center text-white font-bold">
                          <Clock size={20} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-white font-semibold">{item.name}</p>
                              <p className="text-slate-400 text-sm">{item.service} · {item.channel}</p>
                            </div>
                            <span className="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{item.date}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-sm text-indigo-300 font-semibold">{item.time}</span>
                            <span className={`
                              text-xs px-2 py-1 rounded-full border
                              ${item.status === 'confirmada' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' : 'bg-amber-500/20 text-amber-200 border-amber-500/40'}
                            `}>
                              {item.status}
                            </span>
                          </div>
                        </div>
                        <button className="px-3 py-2 rounded-xl bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/30 transition text-xs font-semibold">
                          Reprogramar
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className={`rounded-2xl p-4 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-white font-semibold">Slots por horario</p>
                        <Info size={16} className="text-slate-400" />
                      </div>
                      <div className="space-y-2">
                        {timeSlotsPercent.map((value, idx) => (
                          <div key={idx}>
                            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                              <span>{['9 AM', '12 PM', '3 PM', '6 PM'][idx]}</span>
                              <span>{value}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-teal-500" style={{width: `${value}%`}}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`rounded-2xl p-4 space-y-3 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-white font-semibold">Recordatorios</p>
                        <Bell size={16} className="text-slate-400" />
                      </div>
                      {appts.map((appt, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm text-slate-300">
                          <div className="flex items-center gap-2">
                            <AlertCircle size={14} className="text-indigo-300" />
                            <span>{appt.name}</span>
                          </div>
                          <span className="text-slate-400">{appt.time}</span>
                        </div>
                      ))}
                    </div>
                  </div>
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
                  <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 hover:border-indigo-500/40 transition">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/40 to-teal-500/40 text-white font-bold flex items-center justify-center">
                          {patient.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-white font-semibold">{patient.name}</p>
                          <p className="text-xs text-slate-400">{patient.status === 'nuevo' ? 'Nuevo' : 'Seguimiento'} · {patient.lastVisit}</p>
                        </div>
                      </div>
                      <span className={`
                        text-xs px-2 py-1 rounded-full border
                        ${patient.status === 'activo' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' : ''}
                        ${patient.status === 'nuevo' ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : ''}
                        ${patient.status === 'pendiente' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : ''}
                        ${patient.status === 'inactivo' ? 'bg-slate-800 text-slate-300 border-slate-700' : ''}
                      `}>
                        {patient.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                      <Phone size={14} className="text-teal-300" />
                      <span>{patient.phone}</span>
                      <MapPin size={14} className="text-indigo-300 ml-2" />
                      <span>{patient.location}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Info size={14} />
                        <span>{patient.notes}</span>
                      </div>
                      <button className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 text-xs font-semibold">
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
                      <span className={`
                        text-xs px-2 py-1 rounded-full border justify-self-start
                        ${pay.status === 'pagado' ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' : ''}
                        ${pay.status === 'pendiente' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : ''}
                        ${pay.status === 'reembolsado' ? 'bg-slate-800 text-slate-300 border-slate-700' : ''}
                      `}>
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
                  <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br from-${card.color}-500/30 to-${card.color}-600/30 flex items-center justify-center`}>
                      <card.icon size={18} className="text-white" />
                    </div>
                    <p className="text-slate-400 text-xs">{card.title}</p>
                    <p className="text-white text-2xl font-black">{card.value}</p>
                    <p className="text-emerald-300 text-xs font-semibold">{card.change} vs mes anterior</p>
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
                  { label: 'Mensajes', value: liveStats.messages, icon: MessageCircle, color: 'indigo' },
                  { label: 'Citas activas', value: liveStats.appointments, icon: Calendar, color: 'teal' },
                  { label: 'Pacientes activos', value: liveStats.activePatients, icon: Users, color: 'blue' },
                  { label: 'Tasa respuesta', value: `${liveStats.responseRate.toFixed(1)}%`, icon: TrendingUp, color: 'emerald' }
                ].map((stat, idx) => (
                  <div key={idx} className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2`}>
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br from-${stat.color}-500/30 to-${stat.color}-600/30 flex items-center justify-center`}>
                      <stat.icon size={18} className="text-white" />
                    </div>
                    <p className="text-slate-400 text-xs">{stat.label}</p>
                    <p className="text-white text-2xl font-black">{stat.value}</p>
                    <p className="text-emerald-300 text-xs font-semibold">Tiempo real</p>
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

      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className="fixed bottom-24 right-4 bg-slate-900 border border-slate-800 text-white rounded-full p-3 shadow-lg shadow-indigo-500/30 hover:shadow-2xl transition z-50"
        style={{paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 12px)' : '12px'}}
      >
        <Bell size={20} />
        <span className="absolute -top-1 -right-1 bg-red-500 text-[10px] font-bold rounded-full px-1.5 py-0.5">3</span>
      </button>

      {showNotifications && (
        <div className="fixed bottom-36 right-4 w-80 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 space-y-2 z-50">
          <div className="flex items-center justify-between">
            <p className="text-white font-semibold text-sm">Notificaciones</p>
            <button onClick={() => setShowNotifications(false)} className="p-1 hover:bg-slate-800 rounded-lg">
              <X size={14} className="text-slate-400" />
            </button>
          </div>
          {notifications.map((n) => (
            <div key={n.id} className="flex items-center gap-3 bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2">
              <AlertCircle size={15} className={n.type === 'success' ? 'text-emerald-300' : n.type === 'warning' ? 'text-amber-300' : 'text-indigo-300'} />
              <div className="flex-1">
                <p className="text-slate-200 text-sm">{n.text}</p>
                <p className="text-slate-500 text-xs">{n.time}</p>
              </div>
            </div>
          ))}
        </div>
      )}

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
                className={`relative flex flex-col items-center justify-center px-2 py-2.5 rounded-xl transition-all ${tab === item.id ? 'bg-gradient-to-br from-indigo-600 to-teal-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-400'}`}
              >
                <item.icon size={20} className="mb-0.5" strokeWidth={2.5} fill={tab === item.id ? 'currentColor' : 'none'} />
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
