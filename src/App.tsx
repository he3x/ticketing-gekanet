import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Ticket as TicketIcon,
  Users,
  Settings,
  LogOut,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  Filter,
  Edit3,
  Search,
  Menu,
  X,
  Maximize,
  Phone,
  MapPin,
  User as UserIcon,
  Calendar,
  FileText,
  Paperclip,
  Download,
  Trash2,
  Eye,
  EyeOff,
  Map as MapIcon,
  List,
  Layers,
  RefreshCw,
  Loader2,
  CheckCircle
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, differenceInMinutes, subMonths } from 'date-fns';
import * as XLSX from 'xlsx';
import { cn } from './lib/utils';
import { User, Ticket, TicketType, TicketStatus, UserRole, AppSettings } from './types';

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' }) => {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
    outline: 'border border-gray-300 bg-transparent hover:bg-gray-50',
    ghost: 'hover:bg-gray-100 text-gray-600',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button
      className={cn('px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2', variants[variant], className)}
      {...props}
    />
  );
};

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all', className)} {...props} />
);

const Select = ({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn('w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white', className)} {...props}>
    {children}
  </select>
);

const Card = ({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) => (
  <div onClick={onClick} className={cn('bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden', className)}>{children}</div>
);

const Badge = ({ children, variant = 'default', className }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'info' | 'danger'; className?: string }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-600',
    success: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700',
    info: 'bg-blue-100 text-blue-700',
    danger: 'bg-red-100 text-red-700',
  };
  return <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider', variants[variant], className)}>{children}</span>;
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Real-time clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auth State
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('wifi_user');
    let currentUser = null;
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      setUser(currentUser);
    }
    if (currentUser) {
      fetchData(currentUser);
    }

    // Check for ticketId in URL
    const params = new URLSearchParams(window.location.search);
    if (params.has('ticketId')) {
      setActiveTab('tickets');
    }
  }, []);

  const fetchData = async (currentUser?: User | null) => {
    const activeUser = currentUser || user;
    if (!activeUser) return;

    try {
      const endpoints = ['/api/tickets'];

      // Only superuser can fetch full user list and settings
      if (activeUser?.role === 'superuser') {
        endpoints.push('/api/users');
        endpoints.push('/api/settings');
      } else {
        // Others only get the basic technician list for name resolution
        endpoints.push('/api/technicians');
      }

      const responses = await Promise.all(endpoints.map(url => fetch(url, { cache: 'no-store' })));

      const checkRes = async (res: Response) => {
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          return [];
        }
        return res.json();
      };

      const data = await Promise.all(responses.map(res => checkRes(res)));

      setTickets(data[0]);
      setUsers(data[1]);
      if (activeUser?.role === 'superuser') {
        setSettings(data[2]);
      } else {
        setSettings(null);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error(`Expected JSON but got ${contentType}: ${text.slice(0, 100)}...`);
        setLoginError('Server error: Invalid response format');
        return;
      }

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        localStorage.setItem('wifi_user', JSON.stringify(userData));
        fetchData(userData);
      } else {
        const errorData = await res.json();
        setLoginError(errorData.message || 'Username atau password salah');
      }
    } catch (err) {
      setLoginError('Terjadi kesalahan koneksi');
      console.error('Login error:', err);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setTickets([]);
    setUsers([]);
    setSettings(null);
    localStorage.removeItem('wifi_user');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card className="p-8">
            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 overflow-hidden">
                <img
                  src="https://geka.net.id/img/logo.png"
                  alt="GekaNet Logo"
                  className="w-16 h-16 object-contain"
                />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">GEKANET Ticketing</h1>
              <p className="text-gray-500">Silakan masuk ke akun Anda</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <Input
                  value={loginForm.username}
                  onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                  placeholder="Masukkan username"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={loginForm.password}
                    onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="Masukkan password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
              <Button type="submit" className="w-full py-3 mt-2">Masuk</Button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs text-center text-gray-400">
                &copy; GEKANET 2026 dev by <a href="https://wa.me/6281227647500" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">azis</a> | <a href="https://wa.me/6285156174374" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">sidiq</a>
              </p>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'technician', 'vendor', 'supervisor', 'superuser'] },
    { id: 'tickets', label: 'Tiket Open', icon: TicketIcon, roles: ['admin', 'technician', 'vendor', 'supervisor', 'superuser'] },
    { id: 'tickets_closed', label: 'Tiket Closed', icon: CheckCircle2, roles: ['admin', 'supervisor', 'superuser'] },
    { id: 'export', label: 'Export', icon: Download, roles: ['admin', 'supervisor', 'superuser'] },
    { id: 'reports', label: 'Laporan', icon: CheckCircle2, roles: ['admin', 'supervisor', 'superuser'] },
    { id: 'users', label: 'User', icon: Users, roles: ['superuser'] },
    { id: 'logs', label: 'Log Aktivitas', icon: RefreshCw, roles: ['superuser'] },
    { id: 'settings', label: 'Pengaturan', icon: Settings, roles: ['superuser'] },
  ];

  const filteredNav = navItems.filter(item => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar Mobile Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200 z-50 transition-transform lg:translate-x-0 lg:static",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="p-6 flex items-center gap-3 border-bottom border-gray-100">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 overflow-hidden">
              <img
                src="https://geka.net.id/img/logo.png"
                alt="GekaNet Logo"
                className="w-16 h-16 object-contain"
              />
            </div>
            <span className="font-bold text-xl text-gray-900 tracking-tight">GekaNet</span>
          </div>

          <nav className="flex-1 p-4 space-y-1">
            {filteredNav.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                  activeTab === item.id
                    ? "bg-blue-50 text-blue-600 font-semibold"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-gray-100">
            <div className="flex items-center gap-3 px-4 py-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                {user.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Keluar
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <Menu className="w-6 h-6" />
          </button>
          <h2 className="text-lg font-bold text-gray-900 capitalize">
            {navItems.find(i => i.id === activeTab)?.label}
          </h2>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-medium text-gray-900">{format(currentTime, 'EEEE, d MMMM yyyy')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 tabular-nums">
                  {format(currentTime, 'HH:mm:ss')}
                </span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">WIB</span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-4 lg:p-8 overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DashboardView tickets={tickets} user={user} users={users} />
              </motion.div>
            )}
            {activeTab === 'tickets' && (
              <motion.div key="tickets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TicketsView tickets={tickets} user={user} users={users} onRefresh={fetchData} showClosed={false} />
              </motion.div>
            )}
            {activeTab === 'tickets_closed' && (
              <motion.div key="tickets_closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TicketsView tickets={tickets} user={user} users={users} onRefresh={fetchData} showClosed={true} />
              </motion.div>
            )}
            {activeTab === 'export' && (
              <motion.div key="export" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ExportView tickets={tickets} users={users} />
              </motion.div>
            )}
            {activeTab === 'reports' && (
              <motion.div key="reports" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ReportsView tickets={tickets} users={users} />
              </motion.div>
            )}
            {activeTab === 'users' && (
              <motion.div key="users" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <UsersView users={users} onRefresh={fetchData} />
              </motion.div>
            )}
            {activeTab === 'logs' && (
              <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <LogsView />
              </motion.div>
            )}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SettingsView settings={settings} onRefresh={fetchData} onSettingsSaved={setSettings} user={user} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <p className="text-xs text-center text-gray-400">
              @GEKANET 2026 . dev <a href="https://wa.me/6281227647500" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">azis</a> | <a href="https://wa.me/6285156174374" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">sidiq</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

// --- Helpers ---

const extractCoordinates = (url?: string): [number, number] | null => {
  if (!url) return null;

  // Try to match lat,lng in various Google Maps URL formats
  // Prioritize more specific location markers over map center (@)

  // 1. !3d and !4d (common in place URLs, very specific)
  const d3Match = url.match(/!3d([-+]?\d+\.\d+)/);
  const d4Match = url.match(/!4d([-+]?\d+\.\d+)/);
  if (d3Match && d4Match) return [parseFloat(d3Match[1]), parseFloat(d4Match[1])];

  // 2. query=lat,lng
  const queryMatch = url.match(/query=([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (queryMatch) return [parseFloat(queryMatch[1]), parseFloat(queryMatch[2])];

  // 3. ll=lat,lng
  const llMatch = url.match(/ll=([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (llMatch) return [parseFloat(llMatch[1]), parseFloat(llMatch[2])];

  // 4. q=lat,lng
  const qMatch = url.match(/q=([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (qMatch) return [parseFloat(qMatch[1]), parseFloat(qMatch[2])];

  // 5. /maps/place/lat,lng
  const placeMatch = url.match(/\/maps\/place\/([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (placeMatch) return [parseFloat(placeMatch[1]), parseFloat(placeMatch[2])];

  // 6. /maps/search/lat,lng
  const searchMatch = url.match(/\/maps\/search\/([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (searchMatch) return [parseFloat(searchMatch[1]), parseFloat(searchMatch[2])];

  // 7. /maps/dir/lat,lng
  const dirMatch = url.match(/\/maps\/dir\/([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (dirMatch) return [parseFloat(dirMatch[1]), parseFloat(dirMatch[2])];

  // 8. @lat,lng (often just the map center, use as fallback)
  const atMatch = url.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
  if (atMatch) return [parseFloat(atMatch[1]), parseFloat(atMatch[2])];

  // 9. Just lat,lng in the string (e.g. "-7.123, 110.123")
  const rawMatch = url.match(/([-+]?\d+\.\d+)\s*,\s*([-+]?\d+\.\d+)/);
  if (rawMatch) return [parseFloat(rawMatch[1]), parseFloat(rawMatch[2])];

  return null;
};

// --- Sub-Views ---

function DashboardView({ tickets, user, users }: { tickets: Ticket[]; user: User; users: User[] }) {
  const stats = (user.role === 'technician' || user.role === 'vendor')
    ? {
      total: tickets.filter(t => t.technicianId === user.id || t.assignedTechnicianIds?.includes(user.id)).length,
      open: tickets.filter(t => t.status === 'open').length,
      inProgress: tickets.filter(t => (t.technicianId === user.id || t.assignedTechnicianIds?.includes(user.id)) && t.status === 'in-progress').length,
      completed: tickets.filter(t => (t.technicianId === user.id || t.assignedTechnicianIds?.includes(user.id)) && t.status === 'completed').length,
      maintenance: tickets.filter(t => (t.technicianId === user.id || t.assignedTechnicianIds?.includes(user.id)) && t.type === 'maintenance').length,
      installation: tickets.filter(t => (t.technicianId === user.id || t.assignedTechnicianIds?.includes(user.id)) && t.type === 'installation').length,
    }
    : {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      inProgress: tickets.filter(t => t.status === 'in-progress').length,
      completed: tickets.filter(t => t.status === 'completed').length,
      maintenance: tickets.filter(t => t.type === 'maintenance').length,
      installation: tickets.filter(t => t.type === 'installation').length,
    };

  const userTickets = (user.role === 'technician' || user.role === 'vendor')
    ? tickets.filter(t => (t.technicianId === user.id || t.assignedTechnicianIds?.includes(user.id)) && t.status !== 'completed')
    : tickets.filter(t => t.status !== 'completed');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {(user.role === 'technician' || user.role === 'vendor') && (
        <div className="p-4 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <UserIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-blue-100 text-sm font-medium">Selamat Bekerja,</p>
              <h2 className="text-xl font-bold">{user.name}</h2>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Tiket" value={stats.total} icon={TicketIcon} color="blue" />
        <StatCard title="Tiket Terbuka" value={stats.open} icon={AlertCircle} color="yellow" />
        <StatCard title="Dalam Proses" value={stats.inProgress} icon={Clock} color="orange" />
        <StatCard title="Selesai" value={stats.completed} icon={CheckCircle2} color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Tiket Terbaru</h3>
          <div className="space-y-4">
            {userTickets.slice(0, 5).map(ticket => (
              <div key={ticket.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    ticket.type === 'installation' ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                  )}>
                    {ticket.type === 'installation' ? <Plus className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{ticket.customerName}</p>
                    <p className="text-xs text-gray-500">{ticket.address}</p>
                  </div>
                </div>
                <Badge variant={ticket.status === 'completed' ? 'success' : ticket.status === 'open' ? 'danger' : 'warning'}>
                  {ticket.status}
                </Badge>
              </div>
            ))}
            {userTickets.length === 0 && <p className="text-center text-gray-500 py-8">Belum ada tiket</p>}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Distribusi Pekerjaan</h3>
          <div className="space-y-6">
            <ProgressItem label="Pemasangan Baru" value={stats.installation} total={stats.total} color="bg-blue-500" />
            <ProgressItem label="Maintenance" value={stats.maintenance} total={stats.total} color="bg-orange-500" />
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: any; color: 'blue' | 'yellow' | 'orange' | 'green' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
  };
  return (
    <Card className="p-6 flex items-center gap-4">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", colors[color])}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </Card>
  );
}

function ProgressItem({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">{value} ({Math.round(percentage)}%)</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function TicketsView({ tickets, user, users, onRefresh, showClosed = false }: { tickets: Ticket[]; user: User; users: User[]; onRefresh: () => void; showClosed?: boolean }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isTechPickerOpen, setIsTechPickerOpen] = useState(false);
  const [filterType, setFilterType] = useState<'all' | TicketType>(showClosed ? 'installation' : 'maintenance');
  const [billingFilter, setBillingFilter] = useState<'all' | 'entered' | 'not_entered'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [mapMode, setMapMode] = useState<'street' | 'satellite' | 'hybrid'>('hybrid');
  const [isMapModeDropdownOpen, setIsMapModeDropdownOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [ticketModalMode, setTicketModalMode] = useState<'action' | 'edit'>('action');

  const [newTicket, setNewTicket] = useState({
    type: 'installation' as TicketType,
    customerName: '',
    address: '',
    locationUrl: '',
    phone: '',
    issue: '',
    package: '',
    notes: '',
    attachmentUrl: '',
    attachmentName: '',
  });

  const [report, setReport] = useState({
    status: 'completed' as TicketStatus,
    report: '',
    technicianNotes: '',
    assignedTechnicianIds: [] as string[],
    reportAttachmentUrl: '',
    reportAttachmentName: '',
    customerName: '',
    phone: '',
    address: '',
    locationUrl: '',
    package: '',
    issue: '',
    notes: '',
    type: 'installation' as TicketType,
    billingEntered: false,
  });

  const isFieldWorker = user.role === 'technician' || user.role === 'vendor';
  const isVendor = user.role === 'vendor';
  const canEditTicket = user.role === 'admin' || user.role === 'superuser';
  const technicians = users.filter(u => u.role === 'technician' || !u.role);
  const workerUsers = users.filter(u => u.role === 'technician' || u.role === 'vendor' || !u.role);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get('ticketId');
    if (ticketId && tickets.length > 0) {
      const ticket = tickets.find(t => t.id === ticketId);
      if (ticket) {
        setSelectedTicket(ticket);
        // Clear the URL param so it doesn't reopen on refresh if the user closes it
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [tickets]);

  const filteredTickets = tickets
    .filter(t => showClosed ? t.status === 'completed' : t.status !== 'completed')
    .filter(t => {
      if ((user.role === 'technician' || user.role === 'vendor')) {
        return t.status === 'open';
      }
      return true;
    })
    .filter(t => filterType === 'all' ? true : t.type === filterType)
    .filter(t => {
      if (!showClosed || t.type !== 'installation' || billingFilter === 'all') return true;
      return billingFilter === 'entered' ? !!t.billingEntered : !t.billingEntered;
    })
    .filter(t =>
      t.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.issue && t.issue.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const openTicketModal = (mode: 'action' | 'edit') => {
    if (!selectedTicket) return;
    setTicketModalMode(mode);
    setReport({
      status: selectedTicket.status === 'open' && mode === 'action' ? 'completed' : selectedTicket.status,
      report: selectedTicket.report || '',
      technicianNotes: selectedTicket.technicianNotes || '',
      assignedTechnicianIds: isVendor
        ? [user.id]
        : (selectedTicket.assignedTechnicianIds && selectedTicket.assignedTechnicianIds.length > 0
            ? selectedTicket.assignedTechnicianIds
            : (user.role === 'technician' ? [user.id] : [])),
      reportAttachmentUrl: selectedTicket.reportAttachmentUrl || '',
      reportAttachmentName: selectedTicket.reportAttachmentName || '',
      customerName: selectedTicket.customerName || '',
      phone: selectedTicket.phone || '',
      address: selectedTicket.address || '',
      locationUrl: selectedTicket.locationUrl || '',
      package: selectedTicket.package || '',
      issue: selectedTicket.issue || '',
      notes: selectedTicket.notes || '',
      type: selectedTicket.type,
      billingEntered: !!selectedTicket.billingEntered,
    });
    setIsReportModalOpen(true);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();

    // Duplicate check
    const isDuplicate = tickets.some(t =>
      t.status !== 'completed' &&
      t.customerName.toLowerCase() === newTicket.customerName.toLowerCase()
    );

    if (isDuplicate) {
      if (!confirm(`Pelanggan dengan nama "${newTicket.customerName}" sudah memiliki tiket yang masih aktif. Apakah Anda yakin ingin membuat tiket baru?`)) {
        return;
      }
    }

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTicket)
      });
      if (res.ok) {
        setIsModalOpen(false);
        onRefresh();
        setNewTicket({
          type: 'installation',
          customerName: '',
          address: '',
          locationUrl: '',
          phone: '',
          issue: '',
          package: '',
          notes: '',
          attachmentUrl: '',
          attachmentName: '',
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketModalMode === 'edit' ? {
          customerName: report.customerName,
          phone: report.phone,
          address: report.address,
          locationUrl: report.locationUrl,
          package: report.package,
          issue: report.issue,
          notes: report.notes,
          type: report.type,
          billingEntered: report.billingEntered,
        } : {
          status: report.status,
          report: report.report,
          technicianNotes: report.technicianNotes,
          assignedTechnicianIds: report.assignedTechnicianIds,
          reportAttachmentUrl: report.reportAttachmentUrl,
          reportAttachmentName: report.reportAttachmentName,
          billingEntered: canEditTicket ? report.billingEntered : selectedTicket.billingEntered,
          completedAt: report.status === 'completed' ? (selectedTicket.completedAt || new Date().toISOString()) : undefined
        })
      });
      if (res.ok) {
        setIsReportModalOpen(false);
        setSelectedTicket(null);
        setReport({
          status: 'completed',
          report: '',
          technicianNotes: '',
          assignedTechnicianIds: [],
          reportAttachmentUrl: '',
          reportAttachmentName: '',
          customerName: '',
          phone: '',
          address: '',
          locationUrl: '',
          package: '',
          issue: '',
          notes: '',
          type: 'installation',
          billingEntered: false,
        });
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTicket = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Apakah Anda yakin ingin menghapus tiket ini?')) return;
    try {
      const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              className="pl-10"
              placeholder="Cari pelanggan, alamat, atau kendala..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <Select
            className="w-auto"
            value={filterType}
            onChange={e => setFilterType(e.target.value as any)}
          >
            <option value="all">Semua Tipe</option>
            <option value="installation">Pemasangan</option>
            <option value="maintenance">Maintenance</option>
          </Select>

          {showClosed && filterType === 'installation' && (
            <Select
              className="w-auto"
              value={billingFilter}
              onChange={e => setBillingFilter(e.target.value as any)}
            >
              <option value="all">Semua Billing</option>
              <option value="entered">Sudah Entry Billing</option>
              <option value="not_entered">Belum Entry Billing</option>
            </Select>
          )}

          <div className="flex items-center bg-white rounded-lg border border-gray-300 p-1">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === 'list' ? "bg-blue-50 text-blue-600" : "text-gray-400 hover:text-gray-600"
              )}
              title="List View"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === 'map' ? "bg-blue-50 text-blue-600" : "text-gray-400 hover:text-gray-600"
              )}
              title="Map View"
            >
              <MapIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {(user.role === 'admin' || user.role === 'superuser') && !showClosed && (
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="w-4 h-4" />
            Buat Tiket Baru
          </Button>
        )}
      </div>

      {viewMode === 'list' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredTickets.map(ticket => (
            <div key={ticket.id}>
              <Card className="hover:border-blue-300 transition-all cursor-pointer group" onClick={() => setSelectedTicket(ticket)}>
                {(user.role === 'technician' || user.role === 'vendor') ? (
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                        <UserIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-gray-900 group-hover:text-blue-600 transition-colors leading-tight">{ticket.customerName}</h4>
                        <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-2.5 h-2.5" />
                          {ticket.address}
                        </p>
                        <p className="text-[10px] font-medium text-blue-600 mt-0.5 line-clamp-1">
                          {ticket.type === 'installation' ? `Paket: ${ticket.package}` : `Kendala: ${ticket.issue}`}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-all group-hover:translate-x-1" />
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <Badge variant={ticket.type === 'installation' ? 'info' : 'warning'} className="text-[10px] px-1.5 py-0">
                        {ticket.type === 'installation' ? 'Pemasangan' : 'Maintenance'}
                      </Badge>
                      <Badge variant={ticket.status === 'completed' ? 'success' : ticket.status === 'open' ? 'danger' : 'warning'} className="text-[10px] px-1.5 py-0">
                        {ticket.status}
                      </Badge>
                      {showClosed && ticket.type === 'installation' && (
                        <Badge variant={ticket.billingEntered ? 'success' : 'warning'} className="text-[10px] px-1.5 py-0">
                          {ticket.billingEntered ? 'Billing OK' : 'Belum Billing'}
                        </Badge>
                      )}
                    </div>

                    <div>
                      <h4 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors leading-tight">{ticket.customerName}</h4>
                      <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(parseISO(ticket.createdAt), 'd MMM yyyy, HH:mm')}
                      </p>
                    </div>

                    <div className="space-y-1.5 text-xs text-gray-600">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-1">{ticket.address}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UserIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{technicians.find(t => t.id === ticket.technicianId)?.name || 'Unassigned'}</span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-50 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-gray-400">#{ticket.id.slice(-6)}</span>
                        {!showClosed && (
                          <button
                            onClick={(e) => handleDeleteTicket(e, ticket.id)}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                            title="Hapus Tiket"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-all group-hover:translate-x-1" />
                    </div>
                  </div>
                )}
              </Card>
            </div>
          ))}
          {filteredTickets.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500">
              {showClosed ? 'Tidak ada tiket yang sudah selesai' : 'Tidak ada tiket yang ditemukan'}
            </div>
          )}
        </div>
      ) : (
        <Card className="h-[600px] relative z-0 overflow-hidden">
          <div className="absolute top-4 right-4 z-[1000]">
            <div className="relative">
              <button
                onClick={() => setIsMapModeDropdownOpen(!isMapModeDropdownOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-white/80 backdrop-blur-md border border-gray-200 rounded-lg shadow-lg hover:bg-white transition-all text-sm font-medium text-gray-700"
              >
                <Layers className="w-4 h-4 text-blue-600" />
                <span className="capitalize">{mapMode}</span>
              </button>

              <AnimatePresence>
                {isMapModeDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-32 bg-white rounded-lg shadow-xl border border-gray-100 p-1 overflow-hidden"
                  >
                    {(['street', 'satellite', 'hybrid'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          setMapMode(mode);
                          setIsMapModeDropdownOpen(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs font-medium rounded-md transition-all capitalize",
                          mapMode === mode
                            ? "bg-blue-50 text-blue-600"
                            : "text-gray-600 hover:bg-gray-50"
                        )}
                      >
                        {mode}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <MapContainer
            center={[-7.5, 110.5]}
            zoom={8}
            style={{ height: '100%', width: '100%' }}
          >
            {mapMode === 'street' ? (
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            ) : mapMode === 'satellite' ? (
              <TileLayer
                attribution='&copy; <a href="https://www.esri.com/">Esri</a>, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            ) : (
              <>
                <TileLayer
                  attribution='&copy; <a href="https://www.esri.com/">Esri</a>, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />
                <TileLayer
                  attribution='&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, FAO, NOAA, USGS, EPA, NPS'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                />
              </>
            )}
            {filteredTickets.map(ticket => {
              const coords = extractCoordinates(ticket.locationUrl);
              if (!coords) return null;

              return (
                <Marker
                  key={ticket.id}
                  position={coords}
                  icon={L.icon({
                    iconUrl: ticket.status === 'completed'
                      ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
                      : ticket.type === 'installation'
                        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png'
                        : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                  })}
                >
                  <Popup>
                    <div className="p-1 min-w-[200px]">
                      <div className="flex justify-between items-start mb-2">
                        <Badge variant={ticket.type === 'installation' ? 'info' : 'warning'}>
                          {ticket.type === 'installation' ? 'Pemasangan' : 'Maintenance'}
                        </Badge>
                        <Badge variant={ticket.status === 'completed' ? 'success' : ticket.status === 'open' ? 'danger' : 'warning'}>
                          {ticket.status}
                        </Badge>
                      </div>
                      <h4 className="font-bold text-gray-900 mb-1">{ticket.customerName}</h4>
                      <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {ticket.address}
                      </p>
                      <div className="space-y-1 text-xs text-gray-600 mb-3">
                        <div className="flex items-center gap-2">
                          <UserIcon className="w-3 h-3 text-gray-400" />
                          <span>{technicians.find(t => t.id === ticket.technicianId)?.name || 'Unassigned'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-3 h-3 text-gray-400" />
                          <span className="font-medium text-blue-600">{ticket.type === 'installation' ? ticket.package : ticket.issue}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span>{format(parseISO(ticket.createdAt), 'd MMM yyyy')}</span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full py-1 text-xs"
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        Lihat Detail
                      </Button>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </Card>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedTicket && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTicket(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 className="text-xl font-bold text-gray-900">Detail Tiket</h3>
                <button onClick={() => setSelectedTicket(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Status</p>
                    <Badge variant={selectedTicket.status === 'completed' ? 'success' : 'warning'}>{selectedTicket.status}</Badge>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Tipe</p>
                    <Badge variant={selectedTicket.type === 'installation' ? 'info' : 'warning'}>{selectedTicket.type}</Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <DetailItem icon={UserIcon} label="Pelanggan" value={selectedTicket.customerName} />
                  <DetailItem icon={Phone} label="Telepon" value={selectedTicket.phone} />
                  <DetailItem icon={MapPin} label="Alamat" value={selectedTicket.address} />
                  {selectedTicket.locationUrl && (
                    <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 group/loc">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-blue-600 uppercase font-bold mb-0.5">Lokasi</p>
                        <div className="flex flex-col gap-1">
                          <a
                            href={selectedTicket.locationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-700 hover:underline break-all flex items-center gap-1"
                          >
                            Lihat Lokasi di Peta
                            <ChevronRight className="w-3 h-3" />
                          </a>
                          {!extractCoordinates(selectedTicket.locationUrl) && (
                            <div className="mt-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                              <div className="flex items-center gap-2 text-amber-700 mb-2">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <p className="text-[10px] font-bold uppercase tracking-wider">Koordinat Tidak Terdeteksi</p>
                              </div>
                              <p className="text-[10px] text-amber-600 mb-3 leading-relaxed">
                                Link ini mungkin link pendek (goo.gl) atau format tidak standar. Gunakan tool di bawah untuk menerjemahkannya.
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="w-full h-8 text-[10px] font-bold bg-white border-amber-200 text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-all"
                                disabled={isResolving}
                                onClick={async (e) => {
                                  e.preventDefault();
                                  setIsResolving(true);
                                  try {
                                    const res = await fetch(`/api/tickets/${selectedTicket.id}/resolve-location`, {
                                      method: 'POST'
                                    });
                                    if (res.ok) {
                                      const updatedTicket = await res.json();
                                      setSelectedTicket(updatedTicket);
                                      onRefresh();
                                    } else {
                                      alert('Gagal memperbarui link lokasi');
                                    }
                                  } catch (err) {
                                    console.error(err);
                                  } finally {
                                    setIsResolving(false);
                                  }
                                }}
                              >
                                {isResolving ? (
                                  <Loader2 className="w-3 h-3 animate-spin mr-2" />
                                ) : (
                                  <RefreshCw className="w-3 h-3 mr-2" />
                                )}
                                Terjemahkan Link (Resolve)
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase font-bold flex items-center gap-2">
                      <UserIcon className="w-3 h-3" />
                      Teknisi yang Mengerjakan
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedTicket.assignedTechnicianIds && selectedTicket.assignedTechnicianIds.length > 0 ? (
                        selectedTicket.assignedTechnicianIds.map(id => (
                          <span key={id} className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-blue-100 text-blue-700">
                            {technicians.find(t => t.id === id)?.name || 'Unknown'}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-gray-400 italic">Belum ada teknisi yang ditugaskan</span>
                      )}
                    </div>
                  </div>

                  {selectedTicket.notes && (
                    <DetailItem icon={FileText} label="Catatan Lapor" value={selectedTicket.notes} />
                  )}

                  {selectedTicket.technicianNotes && (
                    <DetailItem icon={FileText} label="Catatan Teknisi" value={selectedTicket.technicianNotes} />
                  )}

                  {selectedTicket.attachmentUrl && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-600 shrink-0">
                            <Paperclip className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-gray-500 uppercase font-bold mb-0.5">Lampiran</p>
                            <p className="text-sm text-gray-700 truncate">{selectedTicket.attachmentName}</p>
                          </div>
                        </div>
                        <a
                          href={selectedTicket.attachmentUrl}
                          download={selectedTicket.attachmentName}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                      <MediaPlayer url={selectedTicket.attachmentUrl} name={selectedTicket.attachmentName} />
                    </div>
                  )}

                  {selectedTicket.type === 'installation' ? (
                    <DetailItem icon={Plus} label="Paket" value={selectedTicket.package || '-'} />
                  ) : (
                    <DetailItem icon={AlertCircle} label="Kendala" value={selectedTicket.issue || '-'} />
                  )}

                  {selectedTicket.report && (
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <p className="text-xs text-blue-600 uppercase font-bold mb-2">Laporan Pekerjaan</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{selectedTicket.report}</p>

                      {selectedTicket.reportAttachmentUrl && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-blue-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <Paperclip className="w-3 h-3 text-blue-500 shrink-0" />
                              <p className="text-xs text-gray-600 truncate">{selectedTicket.reportAttachmentName}</p>
                            </div>
                            <a
                              href={selectedTicket.reportAttachmentUrl}
                              download={selectedTicket.reportAttachmentName}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <Download className="w-3 h-3" />
                            </a>
                          </div>
                          <MediaPlayer url={selectedTicket.reportAttachmentUrl} name={selectedTicket.reportAttachmentName} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex gap-3">
                {selectedTicket.status !== 'completed' && (isFieldWorker || user.role === 'admin' || user.role === 'superuser') && (
                  <Button className="flex-1" onClick={() => openTicketModal('action')}>
                    <CheckCircle2 className="w-4 h-4" />
                    Aksi
                  </Button>
                )}
                {canEditTicket && (
                  <Button variant="outline" className="flex-1" onClick={() => openTicketModal('edit')}>
                    <Edit3 className="w-4 h-4" />
                    Edit
                  </Button>
                )}
                {user.role !== 'technician' && user.role !== 'vendor' && selectedTicket.status === 'open' && (
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/tickets/${selectedTicket.id}/resend-notification`, {
                          method: 'POST'
                        });
                        const data = await res.json();
                        if (res.ok) {
                          alert('Notifikasi berhasil dikirim ulang ke Group WhatsApp');
                        } else {
                          alert(data.message || 'Gagal mengirim notifikasi');
                        }
                      } catch (err) {
                        console.error(err);
                        alert('Terjadi kesalahan saat mengirim notifikasi');
                      }
                    }}
                  >
                    <Phone className="w-4 h-4" />
                    Resend WhatsApp
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={() => setSelectedTicket(null)}>Tutup</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleCreateTicket}>
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <h3 className="text-xl font-bold text-gray-900">Buat Tiket Baru</h3>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipe Tiket</label>
                    <Select value={newTicket.type} onChange={e => setNewTicket({ ...newTicket, type: e.target.value as any })}>
                      <option value="installation">Pemasangan Baru</option>
                      <option value="maintenance">Maintenance</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nama Pelanggan</label>
                    <Input required value={newTicket.customerName} onChange={e => setNewTicket({ ...newTicket, customerName: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Telepon (WhatsApp)</label>
                    <Input required value={newTicket.phone} onChange={e => setNewTicket({ ...newTicket, phone: e.target.value })} placeholder="628123456789" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alamat</label>
                    <textarea
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[80px]"
                      required
                      value={newTicket.address}
                      onChange={e => setNewTicket({ ...newTicket, address: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                      Lokasi (Link Google Maps / Shareloc)
                      {newTicket.locationUrl && extractCoordinates(newTicket.locationUrl) && (
                        <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Ready
                        </span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          className="pr-10"
                          value={newTicket.locationUrl}
                          onChange={e => setNewTicket({ ...newTicket, locationUrl: e.target.value })}
                          placeholder="Tempelkan link Google Maps di sini"
                        />
                        {newTicket.locationUrl && (
                          <button
                            type="button"
                            onClick={() => setNewTicket({ ...newTicket, locationUrl: '' })}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 h-10 px-3"
                        disabled={!newTicket.locationUrl || isResolving}
                        onClick={async () => {
                          if (!newTicket.locationUrl) return;
                          setIsResolving(true);
                          try {
                            const res = await fetch(`/api/resolve-url?url=${encodeURIComponent(newTicket.locationUrl)}`);
                            if (res.ok) {
                              const data = await res.json();
                              setNewTicket({ ...newTicket, locationUrl: data.url });
                            }
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setIsResolving(false);
                          }
                        }}
                      >
                        {isResolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      </Button>
                    </div>

                    {newTicket.locationUrl && (
                      <div className="mt-2 space-y-2">
                        {extractCoordinates(newTicket.locationUrl) ? (
                          <div className="p-2 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-3 h-3 text-blue-600" />
                              <span className="text-[10px] font-mono text-blue-700">
                                {extractCoordinates(newTicket.locationUrl)?.join(', ')}
                              </span>
                            </div>
                            <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">OK</span>
                          </div>
                        ) : (
                          <div className="p-2 bg-amber-50 rounded-lg border border-amber-100 flex items-center gap-2 text-amber-700">
                            <AlertCircle className="w-3 h-3" />
                            <span className="text-[10px] italic">Link tidak mengandung koordinat. Coba klik tombol "Check" di atas.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {newTicket.type === 'installation' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Paket</label>
                      <Input value={newTicket.package} onChange={e => setNewTicket({ ...newTicket, package: e.target.value })} placeholder="Contoh: 20 Mbps" />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Kendala</label>
                      <textarea
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[80px]"
                        value={newTicket.issue}
                        onChange={e => setNewTicket({ ...newTicket, issue: e.target.value })}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Catatan / Note</label>
                    <textarea
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[80px]"
                      value={newTicket.notes}
                      onChange={e => setNewTicket({ ...newTicket, notes: e.target.value })}
                      placeholder="Tambahkan catatan tambahan jika ada..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Upload File Pendukung (Maks 10MB)</label>
                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-xl hover:border-blue-400 transition-colors cursor-pointer relative">
                      <div className="space-y-1 text-center">
                        <Paperclip className="mx-auto h-12 w-12 text-gray-400" />
                        <div className="flex text-sm text-gray-600">
                          <span className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500">
                            {newTicket.attachmentName || "Pilih file untuk diunggah"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">PNG, JPG, PDF up to 10MB</p>
                      </div>
                      <input
                        type="file"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 10 * 1024 * 1024) {
                              alert("Ukuran file maksimal 10MB");
                              return;
                            }
                            const formData = new FormData();
                            formData.append("file", file);
                            try {
                              const res = await fetch("/api/upload", {
                                method: "POST",
                                body: formData,
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setNewTicket({ ...newTicket, attachmentUrl: data.url, attachmentName: data.name });
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                  <Button type="submit" className="flex-1">Simpan Tiket</Button>
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setIsModalOpen(false)}>Batal</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Report Modal */}
      <AnimatePresence>
        {isReportModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsReportModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleUpdateTicket}>
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <h3 className="text-xl font-bold text-gray-900">{ticketModalMode === 'edit' ? 'Edit Data Tiket' : 'Aksi / Laporan Penanganan'}</h3>
                  <button type="button" onClick={() => setIsReportModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  {ticketModalMode === 'edit' && (
                  <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/40 space-y-3">
                    <div className="flex items-center gap-2 text-blue-700 font-bold text-sm">
                      <Edit3 className="w-4 h-4" />
                      Edit Data Tiket
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nama Pelanggan</label>
                        <Input required value={report.customerName} onChange={e => setReport({ ...report, customerName: e.target.value })} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Telepon</label>
                        <Input required value={report.phone} onChange={e => setReport({ ...report, phone: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Alamat</label>
                      <Input required value={report.address} onChange={e => setReport({ ...report, address: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Link Lokasi</label>
                      <Input value={report.locationUrl} onChange={e => setReport({ ...report, locationUrl: e.target.value })} />
                    </div>
                    {report.type === 'installation' ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Paket</label>
                        <Input value={report.package} onChange={e => setReport({ ...report, package: e.target.value })} />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Kendala</label>
                        <textarea className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[80px]" value={report.issue} onChange={e => setReport({ ...report, issue: e.target.value })} />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Catatan Lapor</label>
                      <textarea className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[80px]" value={report.notes} onChange={e => setReport({ ...report, notes: e.target.value })} />
                    </div>
                    {report.type === 'installation' && (
                      <label className="flex items-center gap-3 p-3 bg-white rounded-xl border border-blue-100 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={report.billingEntered}
                          onChange={e => setReport({ ...report, billingEntered: e.target.checked })}
                        />
                        <span className="text-sm font-medium text-gray-700">Sudah di-entry ke billing</span>
                      </label>
                    )}
                  </div>
                  )}
                  {ticketModalMode === 'action' && (
                  <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status Akhir</label>
                    <Select value={report.status} onChange={e => setReport({ ...report, status: e.target.value as any })}>
                      <option value="completed">Selesai</option>
                      <option value="in-progress">Sedang Dikerjakan</option>
                      <option value="cancelled">Dibatalkan</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Laporan</label>
                    <textarea
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[120px]"
                      required={report.status === 'completed'}
                      placeholder="Tuliskan laporan pekerjaan di sini..."
                      value={report.report}
                      onChange={e => setReport({ ...report, report: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Catatan Tambahan</label>
                    <Input value={report.technicianNotes} onChange={e => setReport({ ...report, technicianNotes: e.target.value })} />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pelaksana Pekerjaan</label>
                    {isVendor ? (
                      <div className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
                        <div className="flex flex-wrap gap-1">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                            {user.name}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">Role vendor otomatis tercatat atas nama vendor login dan tidak memilih teknisi.</p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsTechPickerOpen(true)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex flex-wrap gap-1">
                          {report.assignedTechnicianIds.length > 0 ? (
                            report.assignedTechnicianIds.map(id => (
                              <span key={id} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                                {workerUsers.find(t => t.id === id)?.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-gray-400 italic">Pilih teknisi...</span>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Upload Media Pendukung (Maks 10MB)</label>
                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-xl hover:border-blue-400 transition-colors cursor-pointer relative">
                      <div className="space-y-1 text-center">
                        <Paperclip className="mx-auto h-10 w-10 text-gray-400" />
                        <div className="flex text-sm text-gray-600">
                          <span className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500">
                            {report.reportAttachmentName || "Pilih file media"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">PNG, JPG, PDF up to 10MB</p>
                      </div>
                      <input
                        type="file"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 10 * 1024 * 1024) {
                              alert("Ukuran file maksimal 10MB");
                              return;
                            }
                            const formData = new FormData();
                            formData.append("file", file);
                            try {
                              const res = await fetch("/api/upload", {
                                method: "POST",
                                body: formData,
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setReport({ ...report, reportAttachmentUrl: data.url, reportAttachmentName: data.name });
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                  </>
                  )}
                </div>
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                  <Button type="submit" className="flex-1">{ticketModalMode === 'edit' ? 'Simpan Perubahan' : 'Kirim Laporan'}</Button>
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setIsReportModalOpen(false)}>Batal</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Technician Picker Popup */}
      <AnimatePresence>
        {isTechPickerOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTechPickerOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                <h4 className="font-bold text-gray-900">Pilih Teknisi</h4>
                <button onClick={() => setIsTechPickerOpen(false)} className="p-1 hover:bg-gray-100 rounded-full">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
                {technicians.map(t => (
                  <label key={t.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-blue-50 transition-colors cursor-pointer">
                    <span className="font-medium text-gray-700">{t.name}</span>
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={report.assignedTechnicianIds.includes(t.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...report.assignedTechnicianIds, t.id]
                          : report.assignedTechnicianIds.filter(id => id !== t.id);
                        setReport({ ...report, assignedTechnicianIds: ids });
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="p-4 border-t border-gray-100 bg-gray-50">
                <Button className="w-full" onClick={() => setIsTechPickerOpen(false)}>Selesai</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <div>
        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">{label}</p>
        <p className="text-gray-900 font-medium">{value}</p>
      </div>
    </div>
  );
}

function MediaPlayer({ url, name }: { url: string; name: string }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  const isVideo = /\.(mp4|webm|ogg)$/i.test(name);
  const isAudio = /\.(mp3|wav|ogg)$/i.test(name);

  const toggleFullscreen = () => {
    if (isImage || isVideo) {
      setIsFullscreen(!isFullscreen);
    }
  };

  return (
    <>
      {isImage && (
        <div
          className="mt-3 rounded-xl overflow-hidden border border-gray-200 shadow-sm cursor-pointer group relative"
          onClick={toggleFullscreen}
        >
          <img src={url} alt={name} className="w-full h-auto object-cover max-h-[300px]" referrerPolicy="no-referrer" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Maximize className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      )}

      {isVideo && (
        <div className="mt-3 rounded-xl overflow-hidden border border-gray-200 bg-black shadow-sm relative group">
          <video src={url} controls className="w-full h-auto max-h-[300px]" />
          <button
            onClick={toggleFullscreen}
            className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      )}

      {isAudio && (
        <div className="mt-3 p-4 bg-gray-100 rounded-xl border border-gray-200 shadow-sm">
          <audio src={url} controls className="w-full" />
        </div>
      )}

      {!isImage && !isVideo && !isAudio && (
        <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-center gap-3">
          <Paperclip className="w-4 h-4 text-blue-600" />
          <span className="text-xs text-blue-700 font-medium truncate">{name}</span>
        </div>
      )}

      <AnimatePresence>
        {isFullscreen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={toggleFullscreen}
              className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative max-w-full max-h-full z-10 flex flex-col items-center"
            >
              <button
                onClick={toggleFullscreen}
                className="absolute -top-12 right-0 p-2 text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-8 h-8" />
              </button>

              {isImage && (
                <img
                  src={url}
                  alt={name}
                  className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                  referrerPolicy="no-referrer"
                />
              )}

              {isVideo && (
                <video
                  src={url}
                  controls
                  autoPlay
                  className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
                />
              )}

              <div className="mt-4 text-white text-center">
                <p className="text-sm font-medium">{name}</p>
                <a
                  href={url}
                  download={name}
                  className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="w-4 h-4" />
                  Unduh File
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function ExportView({ tickets, users }: { tickets: Ticket[]; users: User[] }) {
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  // Only allow last 3 months
  const months = [0, 1, 2].map(i => {
    const d = subMonths(new Date(), i);
    return {
      value: format(d, 'yyyy-MM'),
      label: format(d, 'MMMM yyyy')
    };
  });

  const handleExport = () => {
    const filtered = tickets.filter(t => format(parseISO(t.createdAt), 'yyyy-MM') === selectedMonth);

    const formatTicket = (t: Ticket) => {
      const techNames = t.assignedTechnicianIds?.map(id => users.find(u => u.id === id)?.name).join(', ') || users.find(u => u.id === t.technicianId)?.name || '-';
      const duration = t.completedAt ? `${differenceInMinutes(parseISO(t.completedAt), parseISO(t.createdAt))} menit` : '-';

      return {
        'Ticket ID': t.id,
        'WaktuLapor': format(parseISO(t.createdAt), 'yyyy-MM-dd HH:mm:ss'),
        'NamaPelanggan': t.customerName,
        'Alamat': t.address,
        'Kontak': t.phone,
        'Kendala': t.type === 'maintenance' ? t.issue : (t.package || '-'),
        'ShareLoc': t.locationUrl || '-',
        'CatatanLapor': t.notes || '-',
        'LampiranLapor': t.attachmentUrl || '-',
        'Status': t.status,
        'NamaTeknisi': techNames,
        'WaktuTangani': t.completedAt ? format(parseISO(t.completedAt), 'yyyy-MM-dd HH:mm:ss') : '-',
        'Solusi/Tindakan': t.report || '-',
        'CatatanTeknisi': t.technicianNotes || '-',
        'LampiranTeknisi': t.reportAttachmentUrl || '-',
        'Durasi': duration
      };
    };

    const maintenance = filtered.filter(t => t.type === 'maintenance').map(formatTicket);
    const installation = filtered.filter(t => t.type === 'installation').map(formatTicket);

    const wb = XLSX.utils.book_new();
    const wsM = XLSX.utils.json_to_sheet(maintenance);
    const wsI = XLSX.utils.json_to_sheet(installation);

    XLSX.utils.book_append_sheet(wb, wsM, 'Maintenance');
    XLSX.utils.book_append_sheet(wb, wsI, 'Pemasangan');

    XLSX.writeFile(wb, `Rekap_Tiket_${selectedMonth}.xlsx`);
  };

  return (
    <Card className="p-8 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mx-auto mb-4">
          <Download className="w-8 h-8" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900">Export Rekap Tiket</h3>
        <p className="text-gray-500 mt-2">Pilih bulan untuk mengunduh rekap tiket (Maksimal 3 bulan terakhir)</p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Pilih Bulan</label>
          <Select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </div>

        <Button className="w-full py-4 text-lg" onClick={handleExport}>
          <Download className="w-5 h-5" />
          Download Excel
        </Button>

        <div className="p-4 bg-yellow-50 rounded-xl border border-yellow-100 flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
          <p className="text-xs text-yellow-700">
            Data tiket akan dihapus otomatis setelah 3 bulan. Pastikan Anda telah mengunduh rekap bulanan sebelum data dihapus.
          </p>
        </div>
      </div>
    </Card>
  );
}

function ReportsView({ tickets, users }: { tickets: Ticket[]; users: User[] }) {
  const [selectedTech, setSelectedTech] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const technicians = users.filter(u => u.role === 'technician' || u.role === 'vendor' || !u.role);

  const handleExport = () => {
    const data = filteredTickets.map(t => {
      const tech = users.find(u => u.id === t.technicianId);
      const assignedTechs = t.assignedTechnicianIds?.map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(', ');

      const createdAt = parseISO(t.createdAt);
      const completedAt = t.completedAt ? parseISO(t.completedAt) : null;
      const duration = completedAt ? differenceInMinutes(completedAt, createdAt) : '-';

      return {
        'Ticket ID': t.id,
        'Waktu Lapor': format(createdAt, 'yyyy-MM-dd HH:mm:ss'),
        'Tipe': t.type === 'installation' ? 'Pemasangan' : 'Maintenance',
        'Nama Pelanggan': t.customerName,
        'Alamat': t.address,
        'Kontak': t.phone,
        'Kendala/Paket': t.type === 'maintenance' ? t.issue : t.package,
        'ShareLoc': t.locationUrl || '-',
        'Catatan Lapor': t.notes || '-',
        'Lampiran Lapor': t.attachmentUrl ? `${window.location.origin}${t.attachmentUrl}` : '-',
        'Status': t.status,
        'Teknisi Utama': tech?.name || '-',
        'Tim Teknisi': assignedTechs || '-',
        'Waktu Tangani': t.completedAt ? format(completedAt, 'yyyy-MM-dd HH:mm:ss') : '-',
        'Solusi/Tindakan': t.report || '-',
        'Catatan Teknisi': t.technicianNotes || '-',
        'Lampiran Teknisi': t.reportAttachmentUrl ? `${window.location.origin}${t.reportAttachmentUrl}` : '-',
        'Durasi (Menit)': duration
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Laporan Pekerjaan");
    XLSX.writeFile(wb, `Laporan_GekaNet_${selectedMonth}.xlsx`);
  };

  const filteredTickets = tickets.filter(t => {
    const date = parseISO(t.createdAt);
    const monthMatch = format(date, 'yyyy-MM') === selectedMonth;
    const techMatch = selectedTech === 'all' || t.technicianId === selectedTech || t.assignedTechnicianIds?.includes(selectedTech);
    return monthMatch && techMatch;
  });

  const stats = {
    total: filteredTickets.length,
    completed: filteredTickets.filter(t => t.status === 'completed').length,
    maintenance: filteredTickets.filter(t => t.type === 'maintenance').length,
    installation: filteredTickets.filter(t => t.type === 'installation').length,
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter Teknisi</label>
            <Select value={selectedTech} onChange={e => setSelectedTech(e.target.value)}>
              <option value="all">Semua Teknisi</option>
              {technicians.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Bulan</label>
            <Input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleExport}
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
              disabled={filteredTickets.length === 0}
            >
              <Download className="w-4 h-4" />
              Export Excel
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Pekerjaan" value={stats.total} icon={TicketIcon} color="blue" />
        <StatCard title="Selesai" value={stats.completed} icon={CheckCircle2} color="green" />
        <StatCard title="Pemasangan" value={stats.installation} icon={Plus} color="blue" />
        <StatCard title="Maintenance" value={stats.maintenance} icon={Settings} color="orange" />
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-6">Rincian Kinerja</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="pb-4 px-4">Teknisi</th>
                <th className="pb-4 px-4">Pemasangan</th>
                <th className="pb-4 px-4">Maintenance</th>
                <th className="pb-4 px-4">Total</th>
                <th className="pb-4 px-4">Selesai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {technicians.filter(tech => selectedTech === 'all' || tech.id === selectedTech).map(tech => {
                const techTickets = filteredTickets.filter(t => t.technicianId === tech.id || t.assignedTechnicianIds?.includes(tech.id));
                return (
                  <tr key={tech.id} className="text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4 font-bold text-gray-900">{tech.name}</td>
                    <td className="py-4 px-4">{techTickets.filter(t => t.type === 'installation').length}</td>
                    <td className="py-4 px-4">{techTickets.filter(t => t.type === 'maintenance').length}</td>
                    <td className="py-4 px-4 font-bold">{techTickets.length}</td>
                    <td className="py-4 px-4">
                      <Badge variant="success">{techTickets.filter(t => t.status === 'completed').length}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-6">Daftar Pekerjaan</h3>
        <div className="space-y-4">
          {filteredTickets.map(ticket => (
            <div
              key={ticket.id}
              className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer group"
              onClick={() => setSelectedTicket(ticket)}
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  ticket.type === 'installation' ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                )}>
                  {ticket.type === 'installation' ? <Plus className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
                </div>
                <div>
                  <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{ticket.customerName}</p>
                  <p className="text-xs text-gray-500">{ticket.address}</p>
                </div>
              </div>
              <div className="text-right flex items-center gap-4">
                <div className="hidden sm:block">
                  <Badge variant={ticket.status === 'completed' ? 'success' : 'warning'}>
                    {ticket.status}
                  </Badge>
                  <p className="text-[10px] text-gray-400 mt-1">{format(parseISO(ticket.createdAt), 'd MMM yyyy')}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-all group-hover:translate-x-1" />
              </div>
            </div>
          ))}
          {filteredTickets.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-500">Tidak ada data pekerjaan untuk filter ini</p>
            </div>
          )}
        </div>
      </Card>

      {/* Detail Modal for Reports */}
      <AnimatePresence>
        {selectedTicket && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTicket(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 className="text-xl font-bold text-gray-900">Detail Laporan</h3>
                <button onClick={() => setSelectedTicket(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Status</p>
                    <Badge variant={selectedTicket.status === 'completed' ? 'success' : 'warning'}>{selectedTicket.status}</Badge>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Tipe</p>
                    <Badge variant={selectedTicket.type === 'installation' ? 'info' : 'warning'}>{selectedTicket.type}</Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <DetailItem icon={UserIcon} label="Pelanggan" value={selectedTicket.customerName} />
                  <DetailItem icon={Phone} label="Telepon" value={selectedTicket.phone} />
                  <DetailItem icon={MapPin} label="Alamat" value={selectedTicket.address} />

                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase font-bold flex items-center gap-2">
                      <UserIcon className="w-3 h-3" />
                      Teknisi yang Mengerjakan
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedTicket.assignedTechnicianIds && selectedTicket.assignedTechnicianIds.length > 0 ? (
                        selectedTicket.assignedTechnicianIds.map(id => (
                          <span key={id} className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-blue-100 text-blue-700">
                            {users.find(u => u.id === id)?.name || 'Unknown'}
                          </span>
                        ))
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-blue-100 text-blue-700">
                          {users.find(u => u.id === selectedTicket.technicianId)?.name || 'Unassigned'}
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedTicket.attachmentUrl && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-600 shrink-0">
                            <Paperclip className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-gray-500 uppercase font-bold mb-0.5">Lampiran Lapor</p>
                            <p className="text-sm text-gray-700 truncate">{selectedTicket.attachmentName}</p>
                          </div>
                        </div>
                        <a href={selectedTicket.attachmentUrl} download className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                      <MediaPlayer url={selectedTicket.attachmentUrl} name={selectedTicket.attachmentName} />
                    </div>
                  )}

                  {selectedTicket.report && (
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <p className="text-xs text-blue-600 uppercase font-bold mb-2">Laporan Pekerjaan</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{selectedTicket.report}</p>

                      {selectedTicket.reportAttachmentUrl && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-blue-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <Paperclip className="w-3 h-3 text-blue-500 shrink-0" />
                              <p className="text-xs text-gray-600 truncate">{selectedTicket.reportAttachmentName}</p>
                            </div>
                            <a href={selectedTicket.reportAttachmentUrl} download className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                              <Download className="w-3 h-3" />
                            </a>
                          </div>
                          <MediaPlayer url={selectedTicket.reportAttachmentUrl} name={selectedTicket.reportAttachmentName} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function UsersView({ users, onRefresh }: { users: User[]; onRefresh: () => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: 'password',
    role: 'technician' as UserRole,
    name: '',
    phone: '',
  });

  useEffect(() => {
    if (editingUser) {
      setFormData({
        username: editingUser.username,
        password: '', // Empty means no change when editing
        role: editingUser.role,
        name: editingUser.name,
        phone: editingUser.phone || '',
      });
      setIsModalOpen(true);
    } else {
      setFormData({
        username: '',
        password: 'password',
        role: 'technician',
        name: '',
        phone: '',
      });
    }
  }, [editingUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
      const method = editingUser ? 'PATCH' : 'POST';

      // If editing and password is empty, don't send it to the server
      const dataToSend = { ...formData };
      if (editingUser && !dataToSend.password) {
        delete (dataToSend as any).password;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });
      if (res.ok) {
        setIsModalOpen(false);
        setEditingUser(null);
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus user ini?')) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-gray-500">Kelola akses pengguna sistem</p>
        <Button onClick={() => { setEditingUser(null); setIsModalOpen(true); }}>
          <Plus className="w-4 h-4" />
          Tambah User
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map(u => (
          <div key={u.id}>
            <Card className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xl">
                  {u.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-900 truncate">{u.name}</h4>
                  <p className="text-xs text-gray-500 capitalize">{u.role}</p>
                </div>
                <Badge variant="info">{u.username}</Badge>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  {u.phone && (
                    <>
                      <Phone className="w-4 h-4 text-gray-400" />
                      {u.phone}
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingUser(u)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit User"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteUser(u.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Hapus User"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsModalOpen(false); setEditingUser(null); }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleSubmit}>
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <h3 className="text-xl font-bold text-gray-900">
                    {editingUser ? 'Edit User' : 'Tambah User Baru'}
                  </h3>
                  <button type="button" onClick={() => { setIsModalOpen(false); setEditingUser(null); }} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
                    <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                    <Input required value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <Select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value as any })}>
                      <option value="technician">Teknisi</option>
                      <option value="vendor">Vendor</option>
                      <option value="admin">Admin</option>
                      <option value="supervisor">Pengawas</option>
                      <option value="superuser">Super User</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Telepon (WhatsApp)</label>
                    <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="628123456789" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password {editingUser && <span className="text-xs font-normal text-gray-400">(Kosongkan jika tidak ingin mengubah)</span>}
                    </label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        required={!editingUser}
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        placeholder={editingUser ? "••••••••" : ""}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                  <Button type="submit" className="flex-1">
                    {editingUser ? 'Simpan Perubahan' : 'Simpan User'}
                  </Button>
                  <Button type="button" variant="outline" className="flex-1" onClick={() => { setIsModalOpen(false); setEditingUser(null); }}>Batal</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingsView({ settings, onRefresh, onSettingsSaved, user }: { settings: AppSettings | null; onRefresh: () => void; onSettingsSaved: (next: AppSettings | null) => void; user: User }) {
  const [token, setToken] = useState(settings?.fonnteToken || '');
  const [group, setGroup] = useState(settings?.whatsappGroup || '');
  const [templateInstallation, setTemplateInstallation] = useState(settings?.templateInstallation || '');
  const [templateMaintenance, setTemplateMaintenance] = useState(settings?.templateMaintenance || '');
  const [templateClosed, setTemplateClosed] = useState(settings?.templateClosed || '');
  const [mediaRetentionDays, setMediaRetentionDays] = useState(settings?.mediaRetentionDays || 60);
  const [activeTab, setActiveTab] = useState<'installation' | 'maintenance' | 'closed'>('installation');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setToken(settings.fonnteToken || '');
    setGroup(settings.whatsappGroup || '');
    setTemplateInstallation(settings.templateInstallation || '');
    setTemplateMaintenance(settings.templateMaintenance || '');
    setTemplateClosed(settings.templateClosed || '');
    setMediaRetentionDays(settings.mediaRetentionDays || 60);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        fonnteToken: token.trim(),
        whatsappGroup: group.trim(),
        templateInstallation,
        templateMaintenance,
        templateClosed,
        mediaRetentionDays
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      const savedSettings = contentType.includes('application/json') ? await res.json() : null;

      if (!res.ok) {
        throw new Error(savedSettings?.message || 'Gagal menyimpan pengaturan');
      }

      if (savedSettings) {
        onSettingsSaved(savedSettings);
        setToken(savedSettings.fonnteToken || '');
        setGroup(savedSettings.whatsappGroup || '');
        setTemplateInstallation(savedSettings.templateInstallation || '');
        setTemplateMaintenance(savedSettings.templateMaintenance || '');
        setTemplateClosed(savedSettings.templateClosed || '');
        setMediaRetentionDays(savedSettings.mediaRetentionDays || 60);
      }

      await onRefresh();
      alert('Pengaturan berhasil disimpan');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan');
    } finally {
      setSaving(false);
    }
  };

  const parameters = [
    { key: '{type}', label: 'Tipe Tiket' },
    { key: '{id}', label: 'ID Tiket' },
    { key: '{customerName}', label: 'Nama Pelanggan' },
    { key: '{address}', label: 'Alamat' },
    { key: '{detail}', label: 'Kendala/Paket' },
    { key: '{location}', label: 'Link Lokasi' },
    { key: '{report}', label: 'Laporan Penanganan' },
    { key: '{notes}', label: 'Catatan Teknisi' },
    { key: '{phone}', label: 'Telepon Pelanggan' },
    { key: '{technician}', label: 'Nama Pelaksana' },
    { key: '{media}', label: 'Link Media/Drive' },
    { key: '{link}', label: 'Link Tiket' },
  ];

  const insertParameter = (param: string) => {
    if (activeTab === 'installation') {
      setTemplateInstallation(prev => prev + param);
    } else if (activeTab === 'maintenance') {
      setTemplateMaintenance(prev => prev + param);
    } else {
      setTemplateClosed(prev => prev + param);
    }
  };

  const formatPreview = (template: string) => {
    return template
      .replace(/{type}/g, activeTab === 'installation' ? 'Pemasangan Baru' : 'Maintenance')
      .replace(/{id}/g, 'TKT-12345')
      .replace(/{customerName}/g, 'Ibu Erka')
      .replace(/{address}/g, 'Jl. Merdeka No. 123')
      .replace(/{detail}/g, activeTab === 'installation' ? 'Paket 50 Mbps' : 'Internet Lambat')
      .replace(/{location}/g, '\nLokasi: https://maps.google.com/...')
      .replace(/{report}/g, 'Sudah dilakukan reset ONT')
      .replace(/{notes}/g, 'Kabel patchcord agak kendor')
      .replace(/{phone}/g, '628123456789')
      .replace(/{technician}/g, 'Budi Technician / Vendor Lapangan')
      .replace(/{media}/g, 'https://drive.google.com/file/d/123456789/view')
      .replace(/{link}/g, '\nLink Tiket: https://app.url/?ticketId=TKT-12345');
  };

  const currentTemplate = activeTab === 'installation'
    ? templateInstallation
    : activeTab === 'maintenance'
      ? templateMaintenance
      : templateClosed;

  const setTemplate = (val: string) => {
    if (activeTab === 'installation') setTemplateInstallation(val);
    else if (activeTab === 'maintenance') setTemplateMaintenance(val);
    else setTemplateClosed(val);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              Konfigurasi API & Group
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fonnte API Token</label>
                <Input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="Masukkan token Fonnte Anda"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Group ID</label>
                <Input
                  value={group}
                  onChange={e => setGroup(e.target.value)}
                  placeholder="Masukkan ID Group WhatsApp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Masa Simpan Media (Hari)</label>
                <Input
                  type="number"
                  value={mediaRetentionDays}
                  onChange={e => setMediaRetentionDays(parseInt(e.target.value) || 0)}
                  placeholder="60"
                />
                <p className="text-[10px] text-gray-500 mt-1">Media yang lebih lama dari jumlah hari ini akan dihapus otomatis oleh sistem.</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-lg font-bold text-gray-900">Template Pesan</h3>
              <div className="flex bg-gray-100 p-1 rounded-lg overflow-x-auto">
                <button
                  onClick={() => setActiveTab('installation')}
                  className={cn(
                    "px-3 py-1.5 text-[10px] font-bold rounded-md transition-all whitespace-nowrap",
                    activeTab === 'installation' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Pemasangan
                </button>
                <button
                  onClick={() => setActiveTab('maintenance')}
                  className={cn(
                    "px-3 py-1.5 text-[10px] font-bold rounded-md transition-all whitespace-nowrap",
                    activeTab === 'maintenance' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Maintenance
                </button>
                <button
                  onClick={() => setActiveTab('closed')}
                  className={cn(
                    "px-3 py-1.5 text-[10px] font-bold rounded-md transition-all whitespace-nowrap",
                    activeTab === 'closed' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Tiket Selesai
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {activeTab === 'installation' ? 'Pesan Pemasangan Baru' : activeTab === 'maintenance' ? 'Pesan Maintenance Baru' : 'Pesan Tiket Selesai'}
                </label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all min-h-[200px] text-sm font-mono leading-relaxed"
                  value={currentTemplate}
                  onChange={e => setTemplate(e.target.value)}
                  placeholder="Ketik template pesan di sini..."
                />
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={handleSave} disabled={saving} className="px-8">
                  {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <Card className="p-6">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Parameter Tersedia</h3>
            <p className="text-xs text-gray-500 mb-4">Klik parameter untuk memasukkan ke dalam editor</p>
            <div className="flex flex-wrap gap-2">
              {parameters.map(param => (
                <button
                  key={param.key}
                  onClick={() => insertParameter(param.key)}
                  className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                >
                  {param.key}
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Preview WhatsApp</h3>
            <div className="bg-[#E5DDD5] rounded-2xl overflow-hidden shadow-lg border border-gray-200">
              <div className="bg-[#075E54] p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white">
                  <UserIcon className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-white font-bold text-sm">GekaNet Bot</h4>
                  <p className="text-white/70 text-[10px]">online</p>
                </div>
              </div>
              <div className="p-4 space-y-4 min-h-[300px] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
                <div className="max-w-[85%] bg-white p-3 rounded-lg rounded-tl-none shadow-sm relative">
                  <div className="absolute top-0 -left-2 w-0 h-0 border-t-[10px] border-t-white border-l-[10px] border-l-transparent" />
                  <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                    {formatPreview(currentTemplate)}
                  </pre>
                  <div className="text-[9px] text-gray-400 text-right mt-1">
                    {format(new Date(), 'HH:mm')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Card className="mt-8 p-6 bg-blue-50 border-blue-100">
        <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Informasi API
        </h4>
        <p className="text-sm text-blue-700 leading-relaxed">
          Sistem ini menggunakan API dari <strong>Fonnte</strong> untuk integrasi WhatsApp.
          Pastikan nomor pengirim sudah aktif di dashboard Fonnte agar notifikasi dapat terkirim dengan lancar.
          Gunakan variabel yang tersedia untuk mempersonalisasi pesan Anda.
        </p>
      </Card>
    </motion.div>
  );
}

function LogsView() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto"
    >
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <RefreshCw className={cn("w-5 h-5 text-blue-600", loading && "animate-spin")} />
              Log Aktivitas Sistem
            </h3>
            <p className="text-sm text-gray-500 mt-1">Memantau seluruh aktivitas perubahan data dan akses sistem</p>
          </div>
          <Button variant="outline" onClick={fetchLogs} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Waktu</th>
                  <th className="px-6 py-4 font-bold text-gray-600 uppercase tracking-wider text-[10px]">User</th>
                  <th className="px-6 py-4 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Aksi</th>
                  <th className="px-6 py-4 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Detail Aktivitas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-gray-400 whitespace-nowrap font-mono text-xs">
                      {format(parseISO(log.timestamp), 'dd MMM yyyy, HH:mm:ss')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 text-[10px] font-bold">
                          {log.user.charAt(0)}
                        </div>
                        <span className="font-semibold text-gray-900">{log.user}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight",
                        log.action === 'LOGIN' ? "bg-green-100 text-green-700" :
                          log.action === 'TICKET_CREATE' ? "bg-blue-100 text-blue-700" :
                            log.action === 'TICKET_UPDATE' ? "bg-orange-100 text-orange-700" :
                              "bg-gray-100 text-gray-700"
                      )}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 leading-relaxed">
                      {log.details}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-400 italic">
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw className="w-8 h-8 text-gray-200" />
                        <span>Belum ada log aktivitas yang tercatat</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
