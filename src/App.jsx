import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, Clock, User, Shield, Download, 
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, 
  Plus, Trash2, Lock, Unlock, AlertTriangle, Loader2, Settings, WifiOff 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, collection, addDoc, updateDoc, 
  deleteDoc, doc, onSnapshot, query, orderBy 
} from 'firebase/firestore';

// --- CONFIGURAÇÃO DO FIREBASE ---

/**
 * NOTA PARA O TIAGO:
 * Para evitar erros de compilação aqui no editor, usei uma lógica que detecta o ambiente.
 * Quando você estiver no VS Code, o código usará automaticamente as suas variáveis do .env.local.
 */

const getFirebaseConfig = () => {
  // Se estivermos no ambiente do Chat/Canvas
  if (typeof __firebase_config !== 'undefined') {
    return JSON.parse(__firebase_config);
  }
  
  // Se estivermos no seu computador (Vite/Vercel)
  // Usamos uma verificação segura para o 'import.meta' não travar o editor
  try {
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    };
  } catch (e) {
    return {}; // Fallback para evitar erro de referência
  }
};

const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ID fixo da sua equipe
const appId = typeof __app_id !== 'undefined' ? __app_id : 'bravo-equipe-acre';

// --- HELPERS ---

const getCycleDates = (baseDate) => {
  const dates = [];
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  let startDate = new Date(year, month, 16);
  if (baseDate.getDate() < 16) {
    startDate = new Date(year, month - 1, 16);
  } else {
    startDate = new Date(year, month, 16);
  }

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 15);

  let current = new Date(startDate);
  while (current <= endDate) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return { dates, startDate, endDate };
};

const formatDateBr = (date) => {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const getDayOfWeek = (date) => {
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return days[date.getDay()];
};

const getTeamForDate = (date) => {
  const anchorDate = new Date(2025, 11, 17); // 17 Dez 2025
  const teams = ['DELTA', 'ALFA', 'BRAVO', 'CHARLIE'];
  const oneDay = 24 * 60 * 60 * 1000;
  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const d2 = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const diffDays = Math.round((d1 - d2) / oneDay);
  let index = diffDays % 4;
  if (index < 0) index += 4;
  return teams[index];
};

// --- COMPONENTE PRINCIPAL ---

export default function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [viewDate, setViewDate] = useState(new Date());
  
  // Dados
  const [agents, setAgents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  
  // UI States
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [isAddingAgent, setIsAddingAgent] = useState(false); 
  
  // Modal de Adição
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [bhType, setBhType] = useState('Noturno'); 

  // --- AUTENTICAÇÃO ---
  
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Erro auth:", error);
        setAuthError(error.message);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- CARREGAMENTO DE DADOS ---

  useEffect(() => {
    if (!user) return;

    const qAgents = query(collection(db, 'artifacts', appId, 'public', 'data', 'agents'));
    const unsubAgents = onSnapshot(qAgents, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAgents(data);
    }, (error) => console.error("Erro agentes:", error));

    const qAssign = query(collection(db, 'artifacts', appId, 'public', 'data', 'assignments'));
    const unsubAssign = onSnapshot(qAssign, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAssignments(data);
    }, (error) => console.error("Erro assignments:", error));

    return () => {
      unsubAgents();
      unsubAssign();
    };
  }, [user]);

  // --- LÓGICA DO RANKING ---

  const { dates: cycleDates, startDate: cycleStart, endDate: cycleEnd } = useMemo(() => {
    return getCycleDates(viewDate);
  }, [viewDate]);

  const cycleLabel = useMemo(() => {
    return `${formatDateBr(cycleStart)} a ${formatDateBr(cycleEnd)}`;
  }, [cycleStart, cycleEnd]);

  const agentRanking = useMemo(() => {
    const agentStats = {};
    
    agents.forEach(agent => {
      agentStats[agent.id] = { bhCount: 0, turnCount: 0, lastAction: null, lastStatus: null };
    });

    assignments.forEach(a => {
      const d = new Date(a.date);
      const actionTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;

      if (agentStats[a.agentId]) {
        agentStats[a.agentId].turnCount += 1;
        if (!agentStats[a.agentId].lastAction || actionTime > agentStats[a.agentId].lastAction) {
          agentStats[a.agentId].lastAction = actionTime;
          agentStats[a.agentId].lastStatus = a.status === 'refused' ? 'refused' : 'accepted';
        }
        if (d >= cycleStart && d <= cycleEnd) {
          if (a.status !== 'refused') agentStats[a.agentId].bhCount += 1;
        }
      }
    });

    return agents.map(agent => ({ ...agent, ...agentStats[agent.id] }))
      .sort((a, b) => {
        if (a.turnCount !== b.turnCount) return a.turnCount - b.turnCount;
        if (a.lastAction === null && b.lastAction !== null) return -1;
        if (a.lastAction !== null && b.lastAction === null) return 1;
        if (a.lastAction !== b.lastAction) return a.lastAction - b.lastAction;
        return a.name.localeCompare(b.name);
      });
  }, [agents, assignments, cycleStart, cycleEnd]);

  // --- AÇÕES ---

  const handleAdminLogin = (e) => {
    if (e) e.preventDefault();
    if (adminPass === 'bravo123') {
      setIsAdmin(true);
      setShowAdminPanel(true);
      setAdminPass('');
    } else {
      alert("Senha incorreta!");
    }
  };

  const handleAddAgent = async () => {
    if (!newAgentName.trim() || isAddingAgent) return;
    
    setIsAddingAgent(true);
    const safetyTimeout = setTimeout(() => setIsAddingAgent(false), 4000);

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'agents'), {
        name: newAgentName,
        createdAt: new Date().toISOString()
      });
      setNewAgentName('');
    } catch (error) {
      console.error(error);
      alert("Erro ao salvar. Verifique a ligação.");
    } finally {
      clearTimeout(safetyTimeout);
      setIsAddingAgent(false);
    }
  };

  const handleDeleteAgent = async (id) => {
    if (!window.confirm('Excluir este agente?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agents', id));
    } catch (e) { console.error(e); }
  };

  const handleAcceptAssignment = async () => {
    if (!selectedAgentId || !selectedDate) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'assignments'), {
        agentId: selectedAgentId,
        date: selectedDate.toISOString(),
        type: bhType,
        status: 'accepted',
        createdAt: new Date().toISOString()
      });
      setSelectedDate(null);
    } catch (e) { console.error(e); }
  };

  const handleRefuseAssignment = async () => {
    if (!selectedAgentId || !selectedDate) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'assignments'), {
        agentId: selectedAgentId,
        date: selectedDate.toISOString(),
        type: bhType,
        status: 'refused',
        createdAt: new Date().toISOString()
      });
      setSelectedDate(null);
    } catch (e) { console.error(e); }
  };

  const handleDeleteAssignment = async (assignId) => {
    if (!window.confirm('Excluir este registo de BH?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'assignments', assignId));
    } catch (e) { console.error(e); }
  };

  const changeCycle = (months) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + months);
    setViewDate(newDate);
  };

  const getAgentStatusIcon = (agent) => {
    if (agent.turnCount === 0 || !agent.lastStatus) return null;
    if (agent.lastStatus === 'accepted') return <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  if (authError) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-center">
        <div className="bg-slate-800 p-8 rounded-lg border-2 border-red-500 max-w-md shadow-2xl">
          <WifiOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Erro de Ligação</h1>
          <p className="text-slate-400 text-sm mb-4">{authError}</p>
          <button onClick={() => window.location.reload()} className="bg-emerald-600 px-6 py-2 rounded font-bold hover:bg-emerald-500 transition">Tentar Novamente</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-yellow-500 flex flex-col overflow-hidden">
      
      {/* HEADER */}
      <header className="bg-slate-800 border-b-4 border-yellow-500 shadow-lg sticky top-0 z-50 flex-shrink-0">
        <div className="w-full px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-yellow-500" />
            <div>
              <h1 className="text-xl font-black text-slate-100 uppercase tracking-wider leading-none">Equipe Bravo</h1>
              <p className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest mt-1">Controle de Banco de Horas</p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-900 p-1.5 rounded-lg border border-slate-700">
            <button onClick={() => changeCycle(-1)} className="p-1 hover:bg-slate-700 rounded text-yellow-500 transition"><ChevronLeft /></button>
            <div className="text-center min-w-[160px]">
              <span className="block text-[9px] text-slate-500 uppercase font-bold tracking-tighter">Ciclo Atual</span>
              <span className="font-bold text-sm text-white">{cycleLabel}</span>
            </div>
            <button onClick={() => changeCycle(1)} className="p-1 hover:bg-slate-700 rounded text-yellow-500 transition"><ChevronRight /></button>
          </div>

          <button onClick={() => setShowAdminPanel(!showAdminPanel)} className={`p-2 rounded border transition ${isAdmin ? 'border-emerald-500 text-emerald-400 bg-emerald-900/20' : 'border-slate-600 text-slate-400'}`}>
            {isAdmin ? <Unlock size={18} /> : <Lock size={18} />}
          </button>
        </div>
      </header>

      {/* ADMIN PANEL */}
      {showAdminPanel && (
        <div className="bg-slate-800 border-b border-slate-700 p-4 animate-in slide-in-from-top duration-300">
          {!isAdmin ? (
            <form onSubmit={handleAdminLogin} className="flex gap-2 max-w-xs mx-auto">
              <input type="password" placeholder="Senha" className="flex-1 bg-slate-900 border border-slate-600 p-2 rounded text-white text-sm focus:border-yellow-500 outline-none" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} />
              <button type="submit" className="bg-yellow-600 text-slate-900 font-bold px-4 rounded text-sm hover:bg-yellow-500">Entrar</button>
            </form>
          ) : (
            <div className="w-full max-w-4xl mx-auto flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <h3 className="font-bold text-yellow-500 mb-2 text-xs uppercase flex items-center gap-2"><User size={14} /> Adicionar Agente</h3>
                <div className="flex gap-2">
                  <input type="text" placeholder="Nome" className="flex-1 bg-slate-900 border border-slate-600 p-2 rounded text-white text-sm focus:border-emerald-500 outline-none" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddAgent()} disabled={isAddingAgent} />
                  <button onClick={handleAddAgent} disabled={isAddingAgent} className="bg-emerald-600 hover:bg-emerald-500 p-2 rounded disabled:opacity-50 transition">
                    {isAddingAgent ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                  </button>
                </div>
              </div>
              <div className="flex-1 max-h-32 overflow-y-auto grid grid-cols-2 gap-2 pr-2 custom-scrollbar">
                {agents.map(a => (
                  <div key={a.id} className="flex justify-between items-center bg-slate-900 p-2 rounded text-xs border border-slate-700 group">
                    <span className="truncate mr-1">{a.name}</span>
                    <button onClick={() => handleDeleteAgent(a.id)} className="text-red-400 hover:text-red-300 transition-colors opacity-60 group-hover:opacity-100"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col lg:flex-row gap-2 p-2 overflow-hidden">
        
        {/* SIDEBAR */}
        <aside className="w-full lg:w-64 flex-shrink-0 bg-slate-800 rounded-lg border border-slate-700 flex flex-col shadow-xl overflow-hidden h-48 lg:h-auto">
          <div className="bg-slate-900 p-2 border-b border-slate-700">
            <h2 className="text-xs font-bold text-emerald-400 flex items-center gap-2 tracking-widest"><Clock size={14} /> FILA DE PRIORIDADE</h2>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-slate-700 custom-scrollbar">
            {agentRanking.map((agent, index) => (
              <div key={agent.id} className={`p-2 flex items-center justify-between text-sm transition-colors ${index === 0 ? 'bg-emerald-900/10 border-l-4 border-emerald-500' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black ${index === 0 ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-400'}`}>{index + 1}</span>
                  <div className="flex flex-col">
                    <span className={`font-medium flex items-center gap-1.5 ${index === 0 ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {agent.name} {getAgentStatusIcon(agent)}
                    </span>
                    {index === 0 && <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-tighter">Está na vez</span>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-bold text-white leading-none">{agent.bhCount}</span>
                  <span className="text-[8px] text-slate-500 block font-bold uppercase tracking-tighter">BHs</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* CALENDÁRIO */}
        <div className="flex-1 bg-slate-800/50 rounded-lg border border-slate-700 p-2 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-1.5">
            {cycleDates.map((date) => {
              const dayOfWeek = getDayOfWeek(date);
              const team = getTeamForDate(date);
              const isSunday = date.getDay() === 0;
              const isSaturday = date.getDay() === 6;
              const dayAssignments = assignments.filter(a => a.status !== 'refused' && new Date(a.date).toDateString() === date.toDateString());

              return (
                <div key={date.toISOString()} className="bg-slate-800 rounded border border-slate-700 flex flex-col min-h-[120px] shadow-sm hover:border-slate-600 transition-colors">
                  <div className={`px-2 py-1 flex justify-between items-center border-b border-slate-700 ${isSunday ? 'bg-red-900/10 text-red-400' : ''} ${isSaturday ? 'bg-blue-900/10 text-blue-400' : ''}`}>
                    <div className="flex items-baseline gap-1">
                      <span className="font-black text-lg">{date.getDate()}</span>
                      <span className="text-[9px] font-bold uppercase opacity-60">{dayOfWeek}</span>
                    </div>
                    <div className={`text-[9px] font-black px-1.5 rounded-sm tracking-tighter ${team === 'DELTA' ? 'bg-yellow-500 text-slate-900 shadow-[0_0_8px_rgba(234,179,8,0.3)]' : 'bg-slate-700 text-slate-400'}`}>{team}</div>
                  </div>
                  <div className="flex-1 p-1 space-y-1 overflow-y-auto custom-scrollbar">
                    {dayAssignments.map(a => (
                      <div key={a.id} className="bg-slate-900/80 rounded px-1.5 py-0.5 text-[11px] border border-slate-700/50 flex justify-between items-center group animate-in fade-in duration-300">
                        <span className="truncate flex-1 pr-1">{agents.find(ag => ag.id === a.agentId)?.name || '...'}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[8px] font-black ${a.type === 'Diurno' ? 'text-yellow-400' : 'text-indigo-400'}`}>{a.type === 'Diurno' ? 'D' : 'N'}</span>
                          <button onClick={() => handleDeleteAssignment(a.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"><Trash2 size={10} /></button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setSelectedDate(date)} className="w-full py-1 mt-1 text-[9px] border border-dashed border-slate-600 text-slate-500 hover:border-yellow-500 hover:text-yellow-500 rounded flex items-center justify-center gap-1 transition-all active:scale-95"><Plus size={10} /> Escalar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* MODAL */}
      {selectedDate && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-slate-800 p-6 rounded-xl border border-yellow-500 w-full max-w-xs shadow-[0_0_50px_rgba(0,0,0,0.5)] relative animate-in zoom-in-95 duration-200">
            <button onClick={() => setSelectedDate(null)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"><XCircle size={24} /></button>
            <h3 className="text-xl font-black text-white mb-1 tracking-tight">ESCALAR BH</h3>
            <p className="text-xs text-yellow-500 font-bold mb-5 uppercase tracking-widest">{formatDateBr(selectedDate)} • EQUIPE {getTeamForDate(selectedDate)}</p>
            
            <div className="space-y-4">
              {agentRanking.length > 0 && (
                <div className="p-3 bg-emerald-900/20 rounded-lg border border-emerald-900/30 flex items-center gap-3 mb-2 ring-1 ring-emerald-500/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Vez de: <span className="text-white text-xs">{agentRanking[0].name}</span></p>
                </div>
              )}
              <div>
                <label className="block text-[10px] text-slate-500 font-bold uppercase mb-1.5 tracking-widest">Agente</label>
                <select className="w-full bg-slate-900 border border-slate-700 p-2.5 rounded-lg text-white text-sm outline-none focus:border-yellow-500 transition-colors appearance-none" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
                  <option value="">Escolha um agente...</option>
                  {agentRanking.map((agent, i) => (<option key={agent.id} value={agent.id}>{i + 1}º - {agent.name}</option>))}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setBhType('Diurno')} className={`flex-1 py-2.5 rounded-lg border text-xs font-black tracking-widest transition-all ${bhType === 'Diurno' ? 'bg-yellow-500 text-slate-900 border-yellow-400 shadow-lg' : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'}`}>DIURNO</button>
                <button onClick={() => setBhType('Noturno')} className={`flex-1 py-2.5 rounded-lg border text-xs font-black tracking-widest transition-all ${bhType === 'Noturno' ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg' : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'}`}>NOTURNO</button>
              </div>
              <div className="flex gap-2 pt-3">
                <button onClick={handleAcceptAssignment} disabled={!selectedAgentId} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3.5 rounded-lg text-xs tracking-widest disabled:opacity-30 transition-all active:scale-95">ACEITAR</button>
                <button onClick={handleRefuseAssignment} disabled={!selectedAgentId} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black py-3.5 rounded-lg text-xs tracking-widest disabled:opacity-30 transition-all active:scale-95">RECUSAR</button>
              </div>
              <p className="text-[9px] text-center text-slate-500 uppercase font-black mt-4 leading-tight opacity-50">Agente irá para o fim da fila em qualquer escolha.</p>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}} />
    </div>
  );
}