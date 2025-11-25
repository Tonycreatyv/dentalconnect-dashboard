import React, { useState, useEffect } from 'react';
import { MessageCircle, Calendar, BarChart3, Settings, LogOut, Menu, X, Send, Plus, CreditCard as Edit2, Search, Filter, Bell, User, Clock, TrendingUp, Users, CheckCircle, Home, FileText, DollarSign, AlertCircle, Phone, Upload, MapPin, Info, Check, Zap } from 'lucide-react';

export default function App() {
  const [auth, setAuth] = useState(false);
  const [loginMode, setLoginMode] = useState(true);
  const [sidebar, setSidebar] = useState(true);
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
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
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
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Nombre de la clínica"
                  value={form.clinic}
                  onChange={(e) => setForm({...form, clinic: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="tel"
                  placeholder="Teléfono"
                  value={form.phone}
                  onChange={(e) => setForm({...form, phone: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={form.pass}
                  onChange={(e) => setForm({...form, pass: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                className="relative w-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-white font-bold py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-cyan-500/30 hover:shadow-2xl hover:shadow-cyan-500/50 hover:scale-[1.02] overflow-hidden group text-sm"
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
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <div>
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={form.pass}
                  onChange={(e) => setForm({...form, pass: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 transition text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                className="relative w-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-white font-bold py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-cyan-500/30 hover:shadow-2xl hover:shadow-cyan-500/50 hover:scale-[1.02] overflow-hidden group text-sm"
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
    <div className="flex h-screen bg-black">
      {!isMobile && (
        <div className="fixed left-0 top-0 h-screen w-64 bg-slate-900 text-white flex flex-col border-r border-slate-800 shadow-xl z-40">
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-xl flex items-center justify-center font-bold text-white text-base flex-shrink-0 shadow-lg shadow-cyan-500/30">
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
            onClick={() => setTab('lobby')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition group ${
              tab === 'lobby'
                ? 'text-white border-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 border-2 border-transparent'
            }`}
          >
            <Home size={19} strokeWidth={2} />
            <span className="font-semibold text-sm">Sala de Espera</span>
          </button>
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition relative group ${
                tab === item.id
                  ? 'text-white border-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800 border-2 border-transparent'
              }`}
            >
              <item.icon size={19} strokeWidth={2} />
              <span className="font-semibold text-sm flex-1 text-left">{item.label}</span>
              {item.badge && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white shadow-md">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-0.5">
          <button
            onClick={() => setTab('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition ${
              tab === 'settings'
                ? 'text-white border-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 border-2 border-transparent'
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
      )}

      <div className={`flex-1 flex flex-col ${!isMobile ? 'ml-64' : 'mb-16'}`}>
        {tab === 'lobby' && (
          <div className="h-screen flex bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden relative">
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-20 left-20 w-72 h-72 bg-cyan-500/20 rounded-full blur-3xl animate-pulse"></div>
              <div className="absolute bottom-20 right-20 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}}></div>
            </div>

            <div className="flex-1 overflow-y-auto relative z-10">
              <div className="max-w-6xl mx-auto px-4 py-6 md:p-8">
                <div className="mb-8">
                  <h1 className="text-2xl md:text-4xl font-black text-white mb-2">
                    Bienvenido, <span className="text-cyan-400">{clinic.name}</span>
                  </h1>
                  <p className="text-slate-400">Aquí está lo que está sucediendo hoy</p>
                </div>

                <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-white">Actualizaciones</h2>
                      <div className="bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full">
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
                          color: 'cyan',
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
                          <div className="relative bg-white/5 backdrop-blur-2xl rounded-full px-4 py-3 border border-white/10 hover:border-white/20 transition-all duration-300 hover:bg-white/10">
                            <div className="flex items-center gap-3.5">
                              <div className={`
                                w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                                ${notif.color === 'cyan' ? 'bg-cyan-500/20' : ''}
                                ${notif.color === 'green' ? 'bg-green-500/20' : ''}
                                ${notif.color === 'blue' ? 'bg-blue-500/20' : ''}
                                ${notif.color === 'emerald' ? 'bg-emerald-500/20' : ''}
                                ${notif.color === 'orange' ? 'bg-orange-500/20' : ''}
                                ${notif.color === 'amber' ? 'bg-amber-500/20' : ''}
                                group-hover:scale-110 transition-transform
                              `}>
                                <notif.icon size={16} className={`
                                  ${notif.color === 'cyan' ? 'text-cyan-400' : ''}
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
                                ${notif.color === 'cyan' ? 'bg-cyan-500 text-white' : ''}
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
                        className="w-full py-3 bg-white/5 backdrop-blur-2xl border border-white/10 hover:border-white/20 hover:bg-white/10 text-white font-semibold rounded-full transition-all"
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
                          <div className="relative bg-white/5 backdrop-blur-2xl rounded-full px-4 py-3 border border-white/10 hover:border-white/20 transition-all duration-300 hover:bg-white/10">
                            <div className="flex items-center gap-3.5">
                              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-teal-500/30 to-cyan-500/30 group-hover:scale-110 transition-transform">
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
                      className="w-full py-3.5 bg-white/5 backdrop-blur-2xl border border-white/10 hover:border-white/20 hover:bg-white/10 text-white font-semibold rounded-full transition-all hover:scale-[1.02]"
                    >
                      Ver todos los pacientes
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20 md:mb-0">
                  {[
                    { icon: Calendar, label: 'Citas hoy', value: '24', color: 'cyan', action: 'appointments' },
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
                    <div className="w-28 h-28 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg mx-auto">
                      <span className="text-4xl font-bold text-white">{clinic.name.charAt(0)}</span>
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">{clinic.name}</h2>
                  <p className="text-sm text-slate-400 mb-6">Tu centro de salud</p>
                  <div className="flex items-center justify-center gap-2 text-cyan-400 mb-8">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                    <span className="text-sm font-semibold">En línea</span>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
                  <h3 className="text-lg font-bold text-white mb-4">Citas de hoy</h3>
                  <div className="space-y-3">
                    {appts.slice(0, 4).map((apt, i) => (
                      <div key={i} className="p-3 bg-slate-700 rounded-xl border border-slate-600 hover:border-cyan-500 transition-all">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">
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
                          <span className="ml-auto px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded-md font-semibold">{apt.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTab('appointments')} className="w-full mt-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                    Ver todas las citas
                  </button>
                </div>

                <div className="bg-gradient-to-br from-cyan-500/20 to-teal-500/20 rounded-2xl p-6 border border-cyan-500/30">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center">
                      <TrendingUp size={24} className="text-cyan-400" />
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
                      <div className="h-full bg-cyan-400 rounded-full" style={{ width: '73%' }}></div>
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
          <div className="flex-1 overflow-auto bg-gray-950">
            <div className="max-w-6xl mx-auto px-4 py-6 md:p-6">
            {tab === 'dashboard' && (
              <div className="space-y-3 md:space-y-4 pb-20 md:pb-6">
                <div className="mb-3">
                  <h2 className="text-xl md:text-2xl font-bold text-white mb-0.5">Resumen del día</h2>
                  <p className="text-xs md:text-sm text-slate-600">{clinic.name}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  {[
                    { icon: MessageCircle, label: 'Mensajes', value: '6', subtext: 'Sin leer', color: 'from-slate-900 to-slate-800', tab: 'messages' },
                    { icon: Calendar, label: 'Citas', value: '8', subtext: 'Hoy', color: 'from-emerald-600 to-emerald-700', tab: 'appointments' },
                    { icon: Users, label: 'Pacientes', value: '24', subtext: 'Atendidos', color: 'from-violet-600 to-violet-700', tab: 'patients' },
                    { icon: DollarSign, label: 'Ingresos', value: '$2.4k', subtext: 'Hoy', color: 'from-amber-600 to-amber-700', tab: 'payments' }
                  ].map((item, i) => (
                    <button key={i} onClick={() => setTab(item.tab)} className={`bg-gradient-to-br ${item.color} rounded-xl p-3 md:p-4 text-left hover:scale-105 transition-transform`}>
                      <item.icon size={isMobile ? 18 : 22} className="text-white mb-2 opacity-90" />
                      <p className="text-xl md:text-2xl font-bold text-white leading-tight">{item.value}</p>
                      <p className="text-xs text-white/80 font-medium">{item.label}</p>
                      <p className="text-xs text-white/60 mt-0.5">{item.subtext}</p>
                    </button>
                  ))}
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl md:rounded-2xl p-3 md:p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-bold text-white">Citas de hoy</h3>
                    <button onClick={() => setTab('appointments')} className="text-xs text-slate-600 hover:text-blue-300 font-medium">Ver todas</button>
                  </div>
                  <div className="space-y-2">
                    {appts.slice(0, 3).map((apt, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5 md:p-3 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition">
                        <div className="w-9 h-9 rounded-lg bg-slate-700/10 flex items-center justify-center flex-shrink-0">
                          <Clock size={16} className="text-slate-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs md:text-sm font-semibold text-white leading-tight">{apt.name}</p>
                          <p className="text-xs text-slate-600">{apt.service}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-slate-900">{apt.time}</p>
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${apt.status === 'confirmada' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                            {apt.status === 'confirmada' ? 'OK' : 'Pend'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl md:rounded-2xl p-3 md:p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-bold text-white">Mensajes sin leer</h3>
                    <button onClick={() => setTab('messages')} className="text-xs text-slate-600 hover:text-blue-300 font-medium">Ver todos</button>
                  </div>
                  <div className="space-y-2">
                    {chats.filter(c => c.unread > 0).map(chat => (
                      <button key={chat.id} onClick={() => { setTab('messages'); setSelected(chat); }} className="w-full flex items-center gap-3 p-2.5 md:p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition text-left">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-700 to-purple-500 flex items-center justify-center flex-shrink-0 font-semibold text-white text-xs">
                          {chat.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs md:text-sm font-semibold text-white leading-tight">{chat.name}</p>
                          <p className="text-xs text-slate-600 truncate">{chat.msg}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{chat.time}</span>
                          <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-md">{chat.unread}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl p-3 md:p-4">
                    <h3 className="text-sm md:text-base font-bold text-white mb-3">Acciones rápidas</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Nueva cita', icon: Plus, tab: 'appointments' },
                        { label: 'Mensaje', icon: Send, tab: 'messages' },
                        { label: 'Paciente', icon: User, tab: 'patients' },
                        { label: 'Pago', icon: DollarSign, tab: 'payments' }
                      ].map((action, i) => (
                        <button key={i} onClick={() => setTab(action.tab)} className="flex flex-col items-center gap-1.5 p-2.5 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition">
                          <action.icon size={18} className="text-slate-600" />
                          <span className="text-xs text-slate-300 font-medium">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-slate-900 to-slate-900 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp size={20} className="text-slate-900" />
                      <h3 className="text-sm md:text-base font-bold text-white">Rendimiento</h3>
                    </div>
                    <p className="text-2xl font-bold text-white mb-1">+23%</p>
                    <p className="text-xs text-white/80">Pacientes esta semana</p>
                    <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full bg-white rounded-full animate-pulse" style={{ width: '73%' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
                              className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition"
                            >
                              <CheckCircle size={16} className="text-slate-900" />
                            </button>
                            <button
                              onClick={() => setEditingChat(null)}
                              className="p-2 bg-slate-200 rounded-lg hover:bg-slate-300 transition"
                            >
                              <X size={16} className="text-slate-900" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setSelected(chat)} className="w-full p-3 text-left relative">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md">
                                {chat.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                  <p className="font-semibold text-white truncate text-sm">{chat.name}</p>
                                  <span className="text-xs text-slate-500 ml-2">{chat.time}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-slate-600 truncate pr-2">{chat.msg}</p>
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
                              className="absolute top-2 right-2 p-1.5 bg-slate-700/80 rounded-lg opacity-0 group-hover:opacity-100 transition hover:bg-gray-600"
                            >
                              <Edit2 size={13} className="text-slate-900" />
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
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md">
                        {selected.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm md:text-base font-semibold text-slate-900 leading-tight">{selected.name}</h3>
                        <p className="text-xs text-slate-800 leading-tight">en línea</p>
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
                    <div className="px-3 md:px-4 py-2 md:py-3 bg-white border-t border-slate-200 flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Escribe un mensaje"
                        className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-slate-900/30 focus:border-slate-900 text-slate-900 placeholder-slate-400 text-sm transition"
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

            {tab === 'patients' && (
              <div className="pb-20 md:pb-6 px-4 md:px-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 md:mb-6 gap-3">
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-teal-400 bg-clip-text text-transparent">Pacientes</h2>
                    <p className="text-xs md:text-sm text-slate-600">Gestiona tu base de pacientes</p>
                  </div>
                  <button className="bg-slate-900 hover:bg-slate-800 text-white px-4 md:px-6 py-2 md:py-2.5 rounded-lg transition flex items-center gap-2 font-semibold text-sm w-full sm:w-auto justify-center shadow-sm">
                    <Plus size={18} /> Nuevo paciente
                  </button>
                </div>
                <div className="space-y-3">
                  {chats.map((patient, i) => (
                    <div key={i} className="bg-slate-900 rounded-xl p-4 hover:bg-slate-800 transition border border-slate-800 shadow-xl">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-11 h-11 bg-gradient-to-br from-slate-900 to-slate-800 rounded-full flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md">
                            {patient.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-white text-sm md:text-base leading-tight">{patient.name}</h3>
                            <p className="text-xs md:text-sm text-slate-600 mt-0.5">+504 9999-{1000 + i}</p>
                            <p className="text-xs text-slate-500 mt-1">Última visita: hace {patient.time}</p>
                          </div>
                        </div>
                        <span className="bg-slate-50 text-slate-900 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap">Activo</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'payments' && (
              <div className="pb-20 md:pb-6 px-4 md:px-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 md:mb-6 gap-3">
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-teal-400 bg-clip-text text-transparent">Pagos</h2>
                    <p className="text-xs md:text-sm text-slate-600">Gestiona ingresos y pagos</p>
                  </div>
                  <button className="bg-slate-900 hover:bg-slate-800 shadow-sm text-white px-4 md:px-6 py-2 md:py-2.5 rounded-lg transition flex items-center gap-2 font-semibold text-sm w-full sm:w-auto justify-center">
                    <Plus size={18} /> Registrar pago
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-6">
                    <DollarSign size={32} className="text-green-400 mb-3" />
                    <p className="text-slate-600 text-sm font-bold mb-1">Ingresos Hoy</p>
                    <p className="text-3xl font-black text-slate-900">$2,450</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-6">
                    <Clock size={32} className="text-yellow-400 mb-3" />
                    <p className="text-slate-600 text-sm font-bold mb-1">Pendientes</p>
                    <p className="text-3xl font-black text-slate-900">$1,200</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-6">
                    <TrendingUp size={32} className="text-slate-600 mb-3" />
                    <p className="text-slate-600 text-sm font-bold mb-1">Este Mes</p>
                    <p className="text-3xl font-black text-slate-900">$18,900</p>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-800">
                        <tr>
                          <th className="text-left p-4 text-slate-300 font-bold text-sm">Paciente</th>
                          <th className="text-left p-4 text-slate-300 font-bold text-sm hidden md:table-cell">Servicio</th>
                          <th className="text-left p-4 text-slate-300 font-bold text-sm">Monto</th>
                          <th className="text-left p-4 text-slate-300 font-bold text-sm">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appts.map((payment, i) => (
                          <tr key={i} className="border-t border-slate-200 hover:bg-slate-50 transition">
                            <td className="p-4 text-slate-900 font-bold text-sm">{payment.name}</td>
                            <td className="p-4 text-slate-600 text-sm hidden md:table-cell">{payment.service}</td>
                            <td className="p-4 text-slate-900 font-bold text-sm">${50 + i * 25}</td>
                            <td className="p-4">
                              <span className={`px-3 py-1 rounded-lg text-xs font-bold ${payment.status === 'confirmada' ? 'bg-green-900 text-green-400' : 'bg-yellow-900 text-yellow-400'}`}>
                                {payment.status === 'confirmada' ? 'Pagado' : 'Pendiente'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === 'reports' && (
              <div>
                <h2 className="text-2xl md:text-3xl font-black mb-6 text-slate-900">📄 Reportes</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                  {[
                    { title: 'Reporte Mensual', desc: 'Resumen de actividades del mes', icon: FileText, color: 'text-slate-600' },
                    { title: 'Reporte de Ingresos', desc: 'Análisis financiero detallado', icon: DollarSign, color: 'text-green-400' },
                    { title: 'Reporte de Pacientes', desc: 'Estadísticas de pacientes', icon: Users, color: 'text-purple-400' },
                    { title: 'Reporte de Citas', desc: 'Historial de citas y asistencias', icon: Calendar, color: 'text-yellow-400' }
                  ].map((report, i) => (
                    <button key={i} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 hover:shadow-lg transition text-left">
                      <report.icon size={32} className={`${report.color} mb-4`} />
                      <h3 className="text-white font-black text-lg mb-2">{report.title}</h3>
                      <p className="text-slate-600 text-sm mb-4">{report.desc}</p>
                      <button className="text-slate-600 font-bold text-sm hover:text-blue-300">Generar →</button>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'appointments' && (
              <div className="pb-20 md:pb-6 px-4 md:px-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 md:mb-6 gap-3">
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-teal-400 bg-clip-text text-transparent">Calendario de Citas</h2>
                    <p className="text-xs md:text-sm text-slate-600">Gestiona tus citas del mes</p>
                  </div>
                  <button className="bg-slate-900 hover:bg-slate-800 shadow-sm text-white px-4 md:px-6 py-2 md:py-2.5 rounded-lg transition flex items-center gap-2 font-semibold text-sm w-full sm:w-auto justify-center">
                    <Plus size={18} /> Nueva cita
                  </button>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-6 mb-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Noviembre 2025</h3>
                    <div className="flex items-center gap-2">
                      <button className="p-2 hover:bg-slate-100 rounded-lg transition">
                        <span className="text-slate-600">←</span>
                      </button>
                      <button className="p-2 hover:bg-slate-100 rounded-lg transition">
                        <span className="text-slate-600">→</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-2 mb-3">
                    {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(day => (
                      <div key={day} className="text-center text-xs font-semibold text-slate-500 py-2">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({length: 35}, (_, i) => {
                      const day = i - 2;
                      const isToday = day === 24;
                      const hasCita = [10, 12, 15, 18, 24, 25, 28].includes(day);
                      return (
                        <button
                          key={i}
                          disabled={day < 1 || day > 30}
                          className={`
                            aspect-square rounded-xl text-sm font-semibold transition relative
                            ${day < 1 || day > 30 ? 'text-slate-300 cursor-default' : ''}
                            ${isToday ? 'bg-slate-900 text-white shadow-md' : ''}
                            ${!isToday && hasCita ? 'bg-slate-50 text-slate-900 hover:bg-cyan-100' : ''}
                            ${!isToday && !hasCita && day >= 1 && day <= 30 ? 'text-slate-700 hover:bg-slate-50' : ''}
                          `}
                        >
                          {day >= 1 && day <= 30 ? day : ''}
                          {hasCita && (
                            <span className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-cyan-500 rounded-full shadow-[0_0_6px_rgba(6,182,212,0.8)]"></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Próximas citas</h3>
                  <div className="space-y-3">
                    {appts.slice(0, 5).map((a, i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:border-cyan-300 transition">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-slate-900 to-slate-800 rounded-full flex items-center justify-center font-semibold text-white text-sm flex-shrink-0 shadow-md">
                            {a.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 text-sm">{a.name}</h4>
                            <p className="text-xs text-slate-600">{a.service}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-semibold text-slate-900">{a.time}</p>
                            <p className="text-xs text-slate-500">{a.date}</p>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${a.status === 'confirmada' ? 'bg-slate-50 text-slate-900' : 'bg-amber-50 text-amber-700'}`}>
                            {a.status === 'confirmada' ? '✓' : '○'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'analytics' && (
              <div className="animate-slide-up px-4 py-6 md:p-6">
                <div className="mb-8 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl md:text-4xl font-black text-white mb-1 flex items-center gap-2 md:gap-3">
                      <BarChart3 size={24} className="text-cyan-400 md:w-8 md:h-8" />
                      Analítica en Vivo
                    </h2>
                    <p className="text-slate-400 text-sm flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                      Actualizando en tiempo real • Últimos 30 días
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  {[
                    { icon: MessageCircle, label: 'Mensajes Hoy', value: liveStats.messages, change: '+12%', color: 'from-slate-900 to-slate-900', textColor: 'text-slate-600', percent: 85 },
                    { icon: Calendar, label: 'Citas Agendadas', value: liveStats.appointments, change: '+8%', color: 'from-green-600 to-green-800', textColor: 'text-green-400', percent: 75 },
                    { icon: TrendingUp, label: 'Tasa Respuesta', value: `${liveStats.responseRate.toFixed(1)}%`, change: '+5%', color: 'from-slate-900 to-purple-800', textColor: 'text-purple-400', percent: 98 },
                    { icon: Users, label: 'Pacientes Activos', value: liveStats.activePatients, change: '+23%', color: 'from-yellow-600 to-yellow-800', textColor: 'text-yellow-400', percent: 92 }
                  ].map((s, i) => (
                    <div key={i} className="relative bg-slate-900 rounded-2xl shadow-2xl p-4 md:p-6 border border-slate-800 overflow-hidden group hover:scale-105 transition-all duration-300">
                      <div className="absolute inset-0 bg-gradient-to-br opacity-10 group-hover:opacity-20 transition-opacity" style={{background: `linear-gradient(135deg, ${s.color})`}}></div>
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
                        <div className={`h-full bg-gradient-to-r ${s.color} transition-all duration-1000`} style={{width: `${s.percent}%`}}></div>
                      </div>
                      <div className="absolute top-4 right-4 w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-4">
                          <div className={`p-3 rounded-xl bg-gradient-to-br ${s.color} shadow-lg animate-pulse-slow`}>
                            <s.icon size={24} className="text-white" />
                          </div>
                          <span className={`text-xs font-black ${s.textColor} bg-slate-800 px-3 py-1.5 rounded-full flex items-center gap-1 animate-bounce-subtle`}>
                            <TrendingUp size={12} />
                            {s.change}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 font-bold mb-2">{s.label}</p>
                        <p className="text-4xl font-black text-white transition-all duration-500">{s.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                  <div className="lg:col-span-2 bg-gradient-to-br from-gray-900 to-gray-900/50 rounded-2xl shadow-2xl p-4 md:p-6 border border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-slate-700/10 rounded-full blur-3xl animate-pulse-slow"></div>
                    <h3 className="text-xl font-black text-white mb-6 flex items-center gap-2 relative z-10">
                      <Clock size={24} className="text-slate-600" />
                      Horario Pico de Actividad
                    </h3>
                    <div className="space-y-4 relative z-10">
                      {[
                        { time: '10:00 AM - 12:00 PM', color: 'from-slate-900 to-slate-600', label: 'Muy Alto' },
                        { time: '2:00 PM - 4:00 PM', color: 'from-green-600 to-green-400', label: 'Alto' },
                        { time: '5:00 PM - 7:00 PM', color: 'from-yellow-600 to-yellow-400', label: 'Medio' },
                        { time: '8:00 AM - 10:00 AM', color: 'from-gray-600 to-gray-400', label: 'Bajo' }
                      ].map((slot, i) => (
                        <div key={i} className="group">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white font-bold text-sm flex items-center gap-2">
                              {slot.time}
                              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                            </span>
                            <span className="text-slate-600 text-xs font-bold bg-slate-800 px-2 py-1 rounded-lg">{slot.label}</span>
                          </div>
                          <div className="relative h-12 bg-slate-800/50 rounded-xl overflow-hidden backdrop-blur-sm">
                            <div className="absolute inset-0 animate-shimmer"></div>
                            <div
                              className={`absolute inset-y-0 left-0 bg-gradient-to-r ${slot.color} rounded-xl transition-all duration-[2000ms] ease-out flex items-center justify-end pr-4 group-hover:shadow-lg`}
                              style={{width: `${timeSlotsPercent[i]}%`}}
                            >
                              <span className="text-white font-black text-lg transition-all duration-500">{Math.round(timeSlotsPercent[i])}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-gray-900 to-gray-900/50 rounded-2xl shadow-2xl p-4 md:p-6 border border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-48 h-48 bg-green-500/10 rounded-full blur-3xl animate-pulse-slow" style={{animationDelay: '1s'}}></div>
                    <h3 className="text-xl font-black text-white mb-6 flex items-center gap-2 relative z-10">
                      <CheckCircle size={24} className="text-green-400" />
                      Tasa de Éxito
                    </h3>
                    <div className="relative z-10">
                      <div className="relative w-48 h-48 mx-auto mb-6">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="96" cy="96" r="88" stroke="#1f2937" strokeWidth="12" fill="none" />
                          <circle
                            cx="96"
                            cy="96"
                            r="88"
                            stroke="url(#gradient)"
                            strokeWidth="12"
                            fill="none"
                            strokeDasharray="552.92"
                            strokeDashoffset={552.92 - (552.92 * satisfactionPercent / 100)}
                            className="transition-all duration-[2000ms] ease-out"
                            strokeLinecap="round"
                          />
                          <defs>
                            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="#10b981" />
                              <stop offset="100%" stopColor="#3b82f6" />
                            </linearGradient>
                          </defs>
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                          <span className="text-5xl font-black text-slate-900 transition-all duration-500">{Math.round(satisfactionPercent)}%</span>
                          <span className="text-xs text-slate-600 font-bold flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                            Satisfacción
                          </span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {[
                          { label: 'Asistencia', value: '95%', color: 'bg-green-500' },
                          { label: 'Puntualidad', value: '88%', color: 'bg-slate-700' },
                          { label: 'Seguimiento', value: '92%', color: 'bg-purple-500' }
                        ].map((metric, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg backdrop-blur-sm hover:bg-slate-800 transition">
                            <span className="text-white font-bold text-sm flex items-center gap-2">
                              <span className={`w-2 h-2 ${metric.color} rounded-full animate-pulse`}></span>
                              {metric.label}
                            </span>
                            <span className="text-slate-300 font-black">{metric.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gradient-to-br from-gray-900 to-gray-900/50 rounded-2xl shadow-2xl p-4 md:p-6 border border-slate-800 relative overflow-hidden">
                    <div className="absolute bottom-0 right-0 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl animate-pulse-slow"></div>
                    <h3 className="text-xl font-black text-white mb-6 flex items-center gap-2 relative z-10">
                      <TrendingUp size={24} className="text-purple-400" />
                      Servicios Más Solicitados
                    </h3>
                    <div className="space-y-4 relative z-10">
                      {[
                        { name: 'Limpieza Dental', percent: 85, color: 'from-slate-900 to-purple-400', count: '145 citas' },
                        { name: 'Consulta General', percent: 65, color: 'from-slate-900 to-slate-600', count: '98 citas' },
                        { name: 'Blanqueamiento', percent: 50, color: 'from-green-600 to-green-400', count: '76 citas' },
                        { name: 'Extracción', percent: 35, color: 'from-yellow-600 to-yellow-400', count: '52 citas' }
                      ].map((service, i) => (
                        <div key={i} className="group">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white font-bold text-sm">{service.name}</span>
                            <span className="text-slate-600 text-xs font-bold">{service.count}</span>
                          </div>
                          <div className="relative h-10 bg-slate-800/50 rounded-xl overflow-hidden backdrop-blur-sm">
                            <div
                              className={`absolute inset-y-0 left-0 bg-gradient-to-r ${service.color} rounded-xl transition-all duration-1000 ease-out flex items-center justify-end pr-3 group-hover:shadow-lg`}
                              style={{width: `${service.percent}%`}}
                            >
                              <span className="text-white font-black text-sm">{service.percent}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-gray-900 to-gray-900/50 rounded-2xl shadow-2xl p-4 md:p-6 border border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-500/10 rounded-full blur-3xl animate-pulse-slow" style={{animationDelay: '0.5s'}}></div>
                    <h3 className="text-xl font-black text-white mb-6 flex items-center gap-2 relative z-10">
                      <Calendar size={24} className="text-yellow-400" />
                      Rendimiento Semanal
                    </h3>
                    <div className="relative z-10">
                      <div className="flex items-end justify-between h-64 gap-2">
                        {[
                          { day: 'L', value: 85, color: 'from-slate-900 to-slate-600' },
                          { day: 'M', value: 92, color: 'from-slate-900 to-slate-600' },
                          { day: 'X', value: 78, color: 'from-slate-900 to-slate-600' },
                          { day: 'J', value: 95, color: 'from-slate-900 to-slate-600' },
                          { day: 'V', value: 88, color: 'from-slate-900 to-slate-600' },
                          { day: 'S', value: 45, color: 'from-gray-600 to-gray-400' },
                          { day: 'D', value: 25, color: 'from-gray-600 to-gray-400' }
                        ].map((item, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                            <div className="relative w-full rounded-t-xl overflow-hidden transition-all duration-500 hover:shadow-lg" style={{height: `${item.value}%`}}>
                              <div className={`w-full h-full bg-gradient-to-t ${item.color} relative`}>
                              </div>
                              <span className="absolute top-2 left-1/2 transform -translate-x-1/2 text-white text-xs font-black opacity-0 group-hover:opacity-100 transition">{item.value}%</span>
                            </div>
                            <span className="text-slate-600 text-xs font-bold">{item.day}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'settings' && (
              <div className="pb-20 md:pb-6 px-4 md:px-6">
                <div className="mb-4 md:mb-6">
                  <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-teal-400 bg-clip-text text-transparent">Configuración</h2>
                  <p className="text-xs md:text-sm text-slate-600">Personaliza tu clínica</p>
                </div>

                <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide -mx-3 px-3 md:mx-0 md:px-0">
                  {[
                    { id: 'general', label: 'General', shortLabel: 'General', icon: Settings },
                    { id: 'schedule', label: 'Horarios', shortLabel: 'Horarios', icon: Clock },
                    { id: 'location', label: 'Dirección', shortLabel: 'Ubicación', icon: MapPin },
                    { id: 'knowledge', label: 'Knowledge Base', shortLabel: 'KB', icon: Info }
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setSettingsTab(st.id)}
                      className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-2 rounded-lg font-semibold text-xs md:text-sm whitespace-nowrap transition flex-shrink-0 ${
                        settingsTab === st.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-800 text-slate-600 hover:bg-slate-700 border border-slate-700'
                      }`}
                    >
                      <st.icon size={14} className="md:w-4 md:h-4" />
                      <span className="hidden sm:inline">{st.label}</span>
                      <span className="sm:hidden">{st.shortLabel}</span>
                    </button>
                  ))}
                </div>

                {settingsTab === 'general' && (
                  <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl p-4 md:p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Nombre de la clínica</label>
                      <input type="text" value={clinic.name} onChange={(e) => setClinic({...clinic, name: e.target.value})} className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Teléfono</label>
                      <input type="text" value={clinic.phone} onChange={(e) => setClinic({...clinic, phone: e.target.value})} className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Email</label>
                      <input type="email" placeholder="clinica@ejemplo.com" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 text-sm" />
                    </div>
                    <div className="mt-6">
                      <h3 className="font-semibold text-white text-base mb-4">Integraciones</h3>

                      {/* WhatsApp */}
                      <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg mb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MessageCircle size={18} className="text-green-600" />
                            <span className="font-semibold text-white text-sm">WhatsApp</span>
                          </div>
                          <button className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition font-semibold text-xs">
                            <Check size={14} className="inline mr-1" /> Conectado
                          </button>
                        </div>
                        <p className="text-green-700 text-xs mt-2">Recibiendo mensajes automáticamente</p>
                      </div>

                      {/* Messenger */}
                      <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MessageCircle size={18} className="text-blue-600" />
                            <span className="font-semibold text-white text-sm">Messenger</span>
                          </div>
                          <button className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition font-semibold text-xs">
                            Conectar
                          </button>
                        </div>
                        <p className="text-slate-500 text-xs mt-2">Responde en Facebook Messenger</p>
                      </div>

                      {/* Instagram */}
                      <div className="bg-pink-500/10 border border-pink-500/20 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MessageCircle size={18} className="text-pink-600" />
                            <span className="font-semibold text-white text-sm">Instagram</span>
                          </div>
                          <button className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition font-semibold text-xs">
                            Conectar
                          </button>
                        </div>
                        <p className="text-slate-500 text-xs mt-2">Responde mensajes directos</p>
                      </div>
                    </div>
                    <button className="w-full bg-slate-900 hover:bg-slate-800 shadow-sm text-white font-semibold py-3 rounded-lg transition text-sm mt-6">
                      Guardar Cambios
                    </button>
                  </div>
                )}

                {settingsTab === 'schedule' && (
                  <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl p-4 md:p-6 space-y-4">
                    <h3 className="text-base font-semibold text-white mb-4">Horario de atención</h3>
                    <div className="space-y-3">
                      {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((day) => (
                        <div key={day} className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                          <input type="checkbox" defaultChecked={day !== 'Domingo'} className="w-4 h-4" />
                          <span className="text-sm font-medium text-white w-24">{day}</span>
                          <input type="time" defaultValue="09:00" className="px-3 py-1.5 bg-slate-700 border border-gray-600 rounded text-white text-xs" />
                          <span className="text-slate-500">-</span>
                          <input type="time" defaultValue="18:00" className="px-3 py-1.5 bg-slate-700 border border-gray-600 rounded text-white text-xs" />
                        </div>
                      ))}
                    </div>
                    <button className="w-full bg-slate-900 hover:bg-slate-800 shadow-sm text-white font-semibold py-3 rounded-lg transition text-sm mt-4">
                      Guardar Horarios
                    </button>
                  </div>
                )}

                {settingsTab === 'location' && (
                  <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl p-4 md:p-6 space-y-4">
                    <h3 className="text-base font-semibold text-white mb-4">Dirección de la clínica</h3>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Dirección completa</label>
                      <textarea
                        placeholder="Calle, número, colonia, ciudad..."
                        rows={3}
                        className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 text-sm resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Código postal</label>
                      <input type="text" placeholder="11000" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Referencias</label>
                      <textarea
                        placeholder="Puntos de referencia para llegar..."
                        rows={2}
                        className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none text-white placeholder-slate-500 text-sm resize-none"
                      />
                    </div>
                    <button className="w-full bg-slate-900 hover:bg-slate-800 shadow-sm text-white font-semibold py-3 rounded-lg transition text-sm mt-4">
                      Guardar Dirección
                    </button>
                  </div>
                )}

                {settingsTab === 'knowledge' && (
                  <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl p-4 md:p-6 space-y-4">
                    <h3 className="text-base font-semibold text-white mb-4">Knowledge Base</h3>
                    <p className="text-xs text-slate-600 mb-4">Sube archivos con información de precios, servicios, horarios y FAQs. El bot usará esta información para responder automáticamente.</p>

                    <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 text-center hover:border-slate-700 transition cursor-pointer">
                      <Upload size={32} className="mx-auto mb-3 text-slate-500" />
                      <p className="text-sm font-semibold text-white mb-1">Subir archivo</p>
                      <p className="text-xs text-slate-600 mb-3">CSV, PDF, TXT (Max 5MB)</p>
                      <input type="file" accept=".csv,.pdf,.txt" className="hidden" id="file-upload" />
                      <label htmlFor="file-upload" className="inline-block bg-slate-900 hover:bg-slate-800 shadow-sm text-white px-4 py-2 rounded-lg transition font-semibold text-sm cursor-pointer">
                        Seleccionar archivo
                      </label>
                    </div>

                    <div className="space-y-2 mt-4">
                      <h4 className="text-sm font-semibold text-slate-300">Archivos subidos</h4>
                      {[
                        { name: 'precios_servicios.pdf', size: '245 KB', date: 'Hace 2 días' },
                        { name: 'horarios_faqs.csv', size: '18 KB', date: 'Hace 1 semana' }
                      ].map((file, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText size={18} className="text-slate-600" />
                            <div>
                              <p className="text-sm font-medium text-slate-900">{file.name}</p>
                              <p className="text-xs text-slate-500">{file.size} • {file.date}</p>
                            </div>
                          </div>
                          <button className="text-red-400 hover:text-red-300 text-xs font-medium">Eliminar</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Logout button - only visible on mobile */}
                {isMobile && (
                  <div className="mt-6">
                    <button
                      onClick={() => setAuth(false)}
                      className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl transition-all shadow-lg"
                    >
                      <LogOut size={20} />
                      <span>Cerrar Sesión</span>
                    </button>
                  </div>
                )}
              </div>
            )}
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
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 z-50 shadow-2xl">
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
                className={`relative flex flex-col items-center justify-center px-2 py-2.5 rounded-xl transition-all ${tab === item.id ? 'bg-gradient-to-br from-cyan-600 to-teal-600 text-white shadow-lg shadow-cyan-500/30' : 'text-slate-400'}`}
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
