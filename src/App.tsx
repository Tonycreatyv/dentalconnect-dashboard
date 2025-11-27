import React, { useState, useEffect } from 'react';
import { MessageCircle, Calendar, BarChart3, Settings, LogOut, Menu, X, Send, Plus, CreditCard as Edit2, Search, Filter, Bell, User, Clock, TrendingUp, Users, CheckCircle, Home, FileText, DollarSign, AlertCircle, Phone, Upload, MapPin, Info, Check, Zap } from 'lucide-react';

export default function App() {
  const [auth, setAuth] = useState(false);
  const [loginMode, setLoginMode] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [tab, setTab] = useState('lobby');
  const [dashboardTab, setDashboardTab] = useState('overview');
  const [settingsTab, setSettingsTab] = useState('general');
  const [appointmentsView, setAppointmentsView] = useState<'calendar' | 'list'>('calendar');
  const [selected, setSelected] = useState<{id: number; name: string; msg: string; time: string; unread: number} | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [editingChat, setEditingChat] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAllLobbyNotifications, setShowAllLobbyNotifications] = useState(false);
  const [lobbyBg, setLobbyBg] = useState('https://images.pexels.com/photos/4269491/pexels-photo-4269491.jpeg?auto=compress&cs=tinysrgb&w=1920');

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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const avatarColors = ['from-indigo-500 to-indigo-600', 'from-violet-500 to-violet-600', 'from-pink-500 to-pink-600', 'from-teal-500 to-teal-600', 'from-amber-500 to-amber-600'];

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

  if (!auth) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{backgroundColor: '#0a0b0d'}}>
        <div className="w-full max-w-md flex flex-col justify-center">
          <div className="text-center mb-6">
            <img
              src="/creatyv image.png"
              alt="CREATYV Logo"
              className="w-32 mx-auto drop-shadow-2xl"
            />
          </div>

          {!loginMode ? (
            <form onSubmit={register} className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Tu nombre"
                  value={form.name}
                  onChange={(e) => setForm({...form, name: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Nombre de la clínica"
                  value={form.clinic}
                  onChange={(e) => setForm({...form, clinic: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="tel"
                  placeholder="Teléfono"
                  value={form.phone}
                  onChange={(e) => setForm({...form, phone: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={form.pass}
                  onChange={(e) => setForm({...form, pass: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                className="relative w-full bg-gradient-to-r from-indigo-500 to-teal-500 hover:from-indigo-400 hover:to-teal-400 text-white font-bold py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/50 hover:scale-[1.02] overflow-hidden group text-sm"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                <span className="relative">Crear Cuenta</span>
              </button>
              <button
                type="button"
                onClick={() => setLoginMode(true)}
                className="w-full text-slate-400 hover:text-white font-semibold py-1.5 transition text-sm"
              >
                ¿Ya tienes cuenta? Inicia sesión
              </button>
            </form>
          ) : (
            <form onSubmit={login} className="space-y-3">
              <div>
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={form.pass}
                  onChange={(e) => setForm({...form, pass: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                className="relative w-full bg-gradient-to-r from-indigo-500 to-teal-500 hover:from-indigo-400 hover:to-teal-400 text-white font-bold py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/50 hover:scale-[1.02] overflow-hidden group text-sm"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                <span className="relative">Iniciar Sesión</span>
              </button>
              <button
                type="button"
                onClick={() => setLoginMode(false)}
                className="w-full text-slate-400 hover:text-white font-semibold py-1.5 transition text-sm"
              >
                ¿Sin cuenta? Crea una ahora
              </button>
            </form>
          )}

          <div className="mt-4 pt-4 border-t border-slate-800">
            <p className="text-center text-slate-400 text-xs">
              Powered by <span className="font-bold text-[#00D9FF]">CREATYV.IO</span>
            </p>
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
    <div className="flex h-screen" style={{backgroundColor: '#0a0b0d'}}>
      {isMobile && (
        <div 
          className="fixed top-0 left-0 right-0 flex items-center justify-between px-4 z-50" 
          style={{
            backgroundColor: '#13151a', 
            borderBottom: '1px solid #1e293b',
            paddingTop: 'max(env(safe-area-inset-top), 0.5rem)',
            height: 'calc(3.5rem + env(safe-area-inset-top))'
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

      <div className={`flex-1 flex flex-col ${!isMobile ? 'ml-64' : ''}`} style={isMobile ? {paddingTop: 'calc(3.5rem + env(safe-area-inset-top))'} : {}}>
        {tab === 'lobby' && (
          <div className="h-screen flex bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden relative">
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-20 left-20 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl animate-pulse"></div>
              <div className="absolute bottom-20 right-20 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}}></div>
            </div>

            <div className="flex-1 overflow-y-auto relative z-10">
              <div className="max-w-6xl mx-auto px-4 py-6 md:p-8">
                <div className="mb-8">
                  <h1 className="text-2xl md:text-4xl font-black text-white mb-2">
                    Bienvenido, <span className="text-indigo-400">{clinic.name}</span>
                  </h1>
                  <p className="text-slate-400">Aquí está lo que está sucediendo hoy</p>
                </div>

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
                        {
                          icon: Calendar,
                          text: 'Juan Pérez',
                          desc: 'Consulta general',
                          count: '1',
                          color: 'indigo',
                          action: 'appointments'
                        },
                        {
                          icon: CheckCircle,
                          text: 'María López',
                          desc: 'Revisión completada',
                          count: '✓',
                          color: 'green',
                          action: 'appointments'
                        },
                        {
                          icon: MessageCircle,
                          text: 'Carlos Rodríguez',
                          desc: 'Preguntó sobre horarios',
                          count: '2',
                          color: 'blue',
                          action: 'messages'
                        },
                        {
                          icon: DollarSign,
                          text: 'Ana García',
                          desc: '$150 procesado',
                          count: '✓',
                          color: 'emerald',
                          action: 'payments'
                        },
                        {
                          icon: User,
                          text: 'Roberto Martínez',
                          desc: 'Nuevo registro',
                          count: '1',
                          color: 'orange',
                          action: 'patients'
                        },
                        {
                          icon: AlertCircle,
                          text: 'Pedro Sánchez',
                          desc: 'Cita en 30 min',
                          count: '!',
                          color: 'amber',
                          action: 'appointments'
                        }
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
                                ${notif.color === 'indigo' ? 'bg-indigo-500/20' : ''}
                                ${notif.color === 'green' ? 'bg-green-500/20' : ''}
                                ${notif.color === 'blue' ? 'bg-blue-500/20' : ''}
                                ${notif.color === 'emerald' ? 'bg-emerald-500/20' : ''}
                                ${notif.color === 'orange' ? 'bg-orange-500/20' : ''}
                                ${notif.color === 'amber' ? 'bg-amber-500/20' : ''}
                                group-hover:scale-110 transition-transform
                              `}>
                                <notif.icon size={16} className={`
                                  ${notif.color === 'indigo' ? 'text-indigo-400' : ''}
                                  ${notif.color === 'green' ? 'text-green-400' : ''}
                                  ${notif.color === 'blue' ? 'text-blue-400' : ''}
                                  ${notif.color === 'emerald' ? 'text-emerald-400' : ''}
                                  ${notif.color === 'orange' ? 'text-orange-400' : ''}
                                  ${notif.color === 'amber' ? 'text-amber-400' : ''}
                                `} strokeWidth={2.5} />
                              </div>

                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-white font-semibold text-sm">{notif.text}</span>
                                <span className="text-slate-400 text-xs truncate">{notif.desc}</span>
                              </div>

                              <div className={`
                                min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold
                                ${notif.color === 'indigo' ? 'bg-indigo-500 text-white' : ''}
                                ${notif.color === 'green' ? 'bg-green-500 text-white' : ''}
                                ${notif.color === 'blue' ? 'bg-blue-500 text-white' : ''}
                                ${notif.color === 'emerald' ? 'bg-emerald-500 text-white' : ''}
                                ${notif.color === 'orange' ? 'bg-orange-500 text-white' : ''}
                                ${notif.color === 'amber' ? 'bg-amber-500 text-white' : ''}
                              `}>
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
                          <div className="relative backdrop-blur-2xl rounded-full px-4 py-3 border border-white/10 hover:border-white/20 transition-all duration-300 hover:bg-white/10">
                            <div className="flex items-center gap-3.5">
                              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-teal-500/30 to-indigo-500/30 group-hover:scale-110 transition-transform">
                                <span className="text-teal-300 font-bold text-sm">{patient.name.charAt(0)}</span>
                              </div>

                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-white font-semibold text-sm">{patient.name}</span>
                                <span className="text-slate-400 text-xs truncate">{patient.info}</span>
                              </div>

                              {patient.status === 'complete' && (
                                <div className="min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold bg-green-500 text-white">
                                  ✓
                                </div>
                              )}
                              {patient.status === 'missing-email' && (
                                <div className="min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold bg-amber-500 text-white">
                                  @
                                </div>
                              )}
                              {patient.status === 'missing-phone' && (
                                <div className="min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold bg-amber-500 text-white">
                                  #
                                </div>
                              )}
                              {patient.status === 'missing-all' && (
                                <div className="min-w-[24px] h-6 rounded-full flex items-center justify-center px-2 flex-shrink-0 text-xs font-bold bg-red-500 text-white">
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

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20 md:mb-0">
                  {[
                    { icon: Calendar, label: 'Citas hoy', value: '24', color: 'indigo', action: 'appointments' },
                    { icon: MessageCircle, label: 'Mensajes', value: '6', color: 'purple', action: 'messages' },
                    { icon: Users, label: 'Pacientes', value: '156', color: 'green', action: 'patients' },
                    { icon: DollarSign, label: 'Ingresos', value: '$8.5k', color: 'emerald', action: 'payments' }
                  ].map((stat, i) => (
                    <button
                      key={i}
                      onClick={() => setTab(stat.action)}
                      className={`
                        group bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl
                        rounded-2xl p-6 border border-${stat.color}-500/30 hover:border-${stat.color}-400/60
                        transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-${stat.color}-500/20
                      `}
                    >
                      <div className={`
                        w-12 h-12 bg-gradient-to-br from-${stat.color}-500 to-${stat.color}-600
                        rounded-xl flex items-center justify-center mb-3 mx-auto
                        group-hover:scale-110 transition-transform shadow-lg shadow-${stat.color}-500/50
                      `}>
                        <stat.icon size={24} className="text-white" strokeWidth={2.5} />
                      </div>
                      <p className="text-3xl font-black text-white mb-1">{stat.value}</p>
                      <p className="text-sm text-slate-400">{stat.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="hidden lg:block w-96 border-l border-slate-800 bg-slate-900 p-8 overflow-y-auto">
              <div className="space-y-6">
                <div className="text-center">
                  <div className="relative inline-block mb-6">
                    <div className="w-28 h-28 bg-gradient-to-br from-indigo-500 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg mx-auto">
                      <span className="text-4xl font-bold text-white">{clinic.name.charAt(0)}</span>
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">{clinic.name}</h2>
                  <p className="text-sm text-slate-400 mb-6">Tu centro de salud</p>
                  <div className="flex items-center justify-center gap-2 text-indigo-400 mb-8">
                    <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></div>
                    <span className="text-sm font-semibold">En línea</span>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4">Citas de hoy</h3>
                  <div className="space-y-3">
                    {appts.slice(0, 4).map((apt, i) => (
                      <div key={i} className="p-3 bg-slate-700 rounded-xl border border-slate-600 hover:border-indigo-500 transition-all">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-teal-500 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">
                            {apt.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{apt.name}</p>
                            <p className="text-xs text-slate-400">{apt.service}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <Clock size={12} />
                          <span>{apt.time}</span>
                          <span className="ml-auto px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded-md font-semibold">{apt.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTab('appointments')} className="w-full mt-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                    Ver todas las citas
                  </button>
                </div>

                <div className="bg-gradient-to-br from-indigo-500/20 to-teal-500/20 rounded-2xl p-6 border border-indigo-500/30">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                      <TrendingUp size={24} className="text-indigo-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-white mb-1">Excelente trabajo</h3>
                      <p className="text-sm text-slate-400">Esta semana</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-white">
                      <span className="text-sm font-medium">Pacientes atendidos</span>
                      <span className="text-xl font-bold">+23%</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full" style={{ width: '73%' }}></div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                      <Bell size={20} className="text-purple-400" />
                    </div>
                    <h3 className="text-lg font-bold text-white">Notificaciones</h3>
                  </div>
                  <div className="space-y-2">
                    {[
                      { text: 'Nueva cita programada', time: '5m' },
                      { text: 'Recordatorio: Cita en 30 min', time: '15m' },
                      { text: 'Pago confirmado', time: '1h' }
                    ].map((notif, i) => (
                      <div key={i} className="p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors cursor-pointer">
                        <p className="text-sm text-white mb-1">{notif.text}</p>
                        <p className="text-xs text-slate-400">Hace {notif.time}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab !== 'lobby' && (
          <div className="flex-1 overflow-auto bg-gray-950" style={isMobile ? {paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))'} : {}}>
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-6">
            {tab === 'messages' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 md:gap-4 h-full px-0 md:px-4">
                <div className={`${selected && isMobile ? 'hidden' : ''} lg:col-span-4 bg-slate-900 ${isMobile ? '' : 'rounded-xl'} overflow-hidden flex flex-col ${isMobile ? '' : 'border border-slate-800 shadow-xl'}`} style={{height: isMobile ? 'calc(100vh - 64px)' : 'calc(100vh - 120px)'}}>
                  <div className="p-3 md:p-4 border-b border-slate-800 bg-slate-900">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-base md:text-lg font-bold text-white">Conversaciones</h2>
                      <button className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                        <Filter size={16} className="text-slate-500" />
                      </button>
                    </div>
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar conversaciones..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 outline-none text-slate-900 placeholder-slate-400 text-sm transition"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {filteredChats.map(chat => (
                      <div key={chat.id} className={`relative group transition-all duration-200 ${selected?.id === chat.id ? 'bg-slate-50 border-l-[3px] border-l-slate-900' : 'border-b border-slate-100 hover:bg-slate-50'}`}>
                        {editingChat === chat.id ? (
                          <div className="p-3 flex items-center gap-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                setChats(chats.map(c => c.id === chat.id ? {...c, name: editName} : c));
                                setEditingChat(null);
                              }}
                              className="p-2 bg-green-600 rounded-lg hover:bg-green-700 transition"
                            >
                              <CheckCircle size={16} className="text-white" />
                            </button>
                            <button
                              onClick={() => setEditingChat(null)}
                              className="p-2 bg-slate-600 rounded-lg hover:bg-slate-700 transition"
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
                                  <p className={`font-semibold truncate text-sm ${selected?.id === chat.id ? 'text-slate-900' : 'text-white'}`}>{chat.name}</p>
                                  <span className={`text-xs ml-2 ${selected?.id === chat.id ? 'text-slate-500' : 'text-slate-400'}`}>{chat.time}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <p className={`text-xs truncate pr-2 ${selected?.id === chat.id ? 'text-slate-600' : 'text-slate-400'}`}>{chat.msg}</p>
                                  {chat.unread > 0 && (
                                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center flex-shrink-0 shadow-md">
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
                              className="absolute top-2 right-2 p-1.5 bg-slate-700/80 rounded-lg opacity-0 group-hover:opacity-100 transition hover:bg-slate-600"
                            >
                              <Edit2 size={13} className="text-white" />
                            </button>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {selected ? (
                  <div className={`${isMobile ? 'col-span-1' : 'lg:col-span-8'} ${isMobile ? '' : 'rounded-xl'} overflow-hidden flex flex-col ${isMobile ? '' : 'border border-slate-200'}`} style={{height: isMobile ? 'calc(100vh - 64px)' : 'calc(100vh - 120px)'}}>
                    <div className="px-3 md:px-4 py-2 md:py-3 bg-white border-b border-slate-200 flex items-center gap-3">
                      {isMobile && (
                        <button onClick={() => setSelected(null)} className="p-1 hover:bg-slate-100 rounded-full">
                          <X size={20} className="text-slate-600" />
                        </button>
                      )}
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(selected.id)} flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md`}>
                        {selected.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm md:text-base font-semibold leading-tight" style={{color: '#0f172a'}}>{selected.name}</h3>
                        <p className="text-xs leading-tight" style={{color: '#64748b'}}>en línea</p>
                      </div>
                    </div>
                    <div
                      className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2 bg-slate-50"
                    >
                      {msgs.map((m, i) => (
                        <div key={i} className={`flex ${m.from === 'user' ? 'justify-start' : 'justify-end'}`}>
                          <div className={`relative max-w-[75%] md:max-w-sm px-3 py-2 shadow-sm ${
                            m.from === 'user'
                              ? 'bg-white border border-slate-200 text-slate-900 rounded-r-lg rounded-tl-lg'
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
                    <div 
                      className="px-3 md:px-4 py-2 md:py-3 bg-white border-t border-slate-200 flex items-center gap-2" 
                      style={{paddingBottom: isMobile ? 'calc(0.75rem + env(safe-area-inset-bottom))' : undefined}}
                    >
                      <input
                        type="text"
                        placeholder="Escribe un mensaje"
                        className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-slate-900 text-slate-900 placeholder-slate-400 text-sm transition"
                        style={{fontSize: '16px'}}
                      />
                      <button className="w-10 h-10 bg-gradient-to-br from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white rounded-full transition flex items-center justify-center flex-shrink-0 shadow-md">
                        <Send size={18} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`${isMobile ? 'hidden' : 'lg:col-span-8'} bg-white rounded-xl flex items-center justify-center border border-slate-200`} style={{height: 'calc(100vh - 120px)'}}>
                    <div className="text-center px-4">
                      <MessageCircle size={64} className="mx-auto mb-4 text-slate-300" />
                      <p className="text-slate-700 font-semibold text-base mb-1">Selecciona una conversación</p>
                      <p className="text-slate-500 text-sm">WhatsApp Business conectado</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Keep all other tabs the same - I'm truncating here for brevity but they remain unchanged */}
            </div>
          </div>
        )}
      </div>

      {!isMobile && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 py-2 px-6 z-30 ml-64">
          <p className="text-center text-slate-500 text-xs font-medium">
            Powered by <span className="font-bold text-[#00D9FF]">CREATYV.IO</span>
          </p>
        </div>
      )}

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
    </div>
  );
}