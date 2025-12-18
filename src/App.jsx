import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, Clock, User, Shield, Download, 
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, 
  Plus, Trash2, Lock, Unlock, AlertTriangle, Loader2, Settings, WifiOff, Database, ListFilter
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

const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined') {
    return JSON.parse(__firebase_config);
  }
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
    return {};
  }
};

const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
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

const formatDateBr = (date) => date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const getDayOfWeek = (date) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][date.getDay()];

const getTeamForDate = (date) => {
  const anchorDate = new Date(2025, 11, 17);
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
  const [dbStatus, setDbStatus] = useState('connecting');
  const [viewDate, setViewDate] = useState(new Date());
  
  const [agents, setAgents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [isAddingAgent, setIsAddingAgent] = useState(false); 
  
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [bhType, setBhType] = useState('Noturno'); 

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        setAuthError(error.message);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    setDbStatus('online');
    const qAgents = query(collection(db, 'artifacts', appId, 'public', 'data', 'agents'));
    const unsubAgents = onSnapshot(qAgents, (s) => setAgents(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => setDbStatus('error'));

    const qAssign = query(collection(db, 'artifacts', appId, 'public', 'data', 'assignments'));
    const unsubAssign = onSnapshot(qAssign, (s) => setAssignments(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => setDbStatus('error'));

    return () => { unsubAgents(); unsubAssign(); };
  }, [user]);

  const { startDate: cycleStart, endDate: cycleEnd } = useMemo(() => getCycleDates(viewDate), [viewDate]);

  // --- LÓGICA DO RODÍZIO DEMOCRÁTICO ---
  const agentRanking = useMemo(() => {
    const stats = {};
    agents.forEach(a => {
      stats[a.id] = { 
        balance: 0,       // Saldo total de horas (Aceites)
        turnsTaken: 0,    // Quantidade de vezes que Aceitou ou Recusou
        lastActionDate: 0 
      };
    });

    assignments.forEach(a => {
      if (!stats[a.agentId]) return;
      
      // Saldo Acumulado (Apenas Aceitos)
      if (a.status === 'accepted') {
        stats[a.agentId].balance += 1;
      }

      // Contador de Oportunidades Exercidas (Aceitos + Recusados)
      if (a.status === 'accepted' || a.status === 'refused') {
        stats[a.agentId].turnsTaken += 1;
        const time = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        if (time > stats[a.agentId].lastActionDate) {
          stats[a.agentId].lastActionDate = time;
        }
      }
    });

    // Determinar o patamar do ciclo
    const turnValues = Object.values(stats).map(s => s.turnsTaken);
    const minTurns = turnValues.length > 0 ? Math.min(...turnValues) : 0;

    return agents.map(agent => ({
      ...agent,
      ...stats[agent.id],
      isDoneInCurrentCycle: stats[agent.id].turnsTaken > minTurns
    })).sort((a, b) => {
      // REGRA 2: Quem já jogou no ciclo atual vai para o final
      if (a.isDoneInCurrentCycle !== b.isDoneInCurrentCycle) {
        return a.isDoneInCurrentCycle ? 1 : -1;
      }
      
      // REGRA 1: Menor Saldo tem prioridade
      if (a.balance !== b.balance) {
        return a.balance - b.balance;
      }

      // REGRA 7: Desempate por Ordem Alfabética
      return a.name.localeCompare(b.name);
    });
  }, [agents, assignments]);

  const handleAddAgent = async () => {
    if (!newAgentName.trim() || isAddingAgent || !db) return;
    setIsAddingAgent(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'agents'), {
        name: newAgentName,
        createdAt: new Date().toISOString()
      });
      setNewAgentName('');
    } catch (e) { alert("Erro: " + e.message); }
    finally { setIsAddingAgent(false); }
  };

  const handleAssignment = async (status) => {
    if (!selectedAgentId || !selectedDate || !db) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'assignments'), {
        agentId: selectedAgentId,
        date: selectedDate.toISOString(),
        type: bhType,
        status: status,
        createdAt: new Date().toISOString()
      });
      setSelectedDate(null);
      setSelectedAgentId('');
    } catch (e) { alert("Erro: " + e.message); }
  };

  if (authError) return <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white">Erro de Autenticação: {authError}</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans flex flex-col overflow-hidden">
      
      {/* STATUS BAR */}
      <div className={`text-[10px] font-black uppercase tracking-widest text-center py-1 flex items-center justify-center gap-2 ${dbStatus === 'online' ? 'bg-emerald-900/20 text-emerald-500' : 'bg-red-900/20 text-red-500'}`}>
        <Database size={10} />
        {dbStatus === 'online' ? 'Sistema de Rodízio Ativo' : 'Erro de Conexão'}
      </div>

      {/* HEADER */}
      <header className="bg-slate-800 border-b-4 border-yellow-500 shadow-lg p-3">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-yellow-500" />
            <div>
              <h1 className="text-xl font-black text-slate-100 uppercase tracking-tighter leading-none">Equipe Bravo</h1>
              <p className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest mt-1">Rodízio Democrático de BH</p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-900 p-1.5 rounded-xl border border-slate-700">
            <button onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() - 1)))} className="p-1 hover:bg-slate-700 rounded text-yellow-500"><ChevronLeft /></button>
            <div className="text-center min-w-[140px]">
              <span className="font-bold text-xs text-white uppercase tracking-tighter">
                {formatDateBr(getCycleDates(viewDate).startDate)} - {formatDateBr(getCycleDates(viewDate).endDate)}
              </span>
            </div>
            <button onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() + 1)))} className="p-1 hover:bg-slate-700 rounded text-yellow-500"><ChevronRight /></button>
          </div>

          <button onClick={() => setShowAdminPanel(!showAdminPanel)} className={`p-2 rounded-lg border transition ${isAdmin ? 'border-emerald-500 text-emerald-400 bg-emerald-900/20' : 'border-slate-600 text-slate-400'}`}>
            {isAdmin ? <Unlock size={18} /> : <Lock size={18} />}
          </button>
        </div>
      </header>

      {/* ADMIN */}
      {showAdminPanel && (
        <div className="bg-slate-800 border-b border-slate-700 p-4 animate-in slide-in-from-top duration-300">
          {!isAdmin ? (
            <form onSubmit={(e) => { e.preventDefault(); if(adminPass === 'bravo123') setIsAdmin(true); else alert('Senha Errada'); }} className="flex gap-2 max-w-xs mx-auto">
              <input type="password" placeholder="Senha" className="flex-1 bg-slate-900 border border-slate-600 p-2 rounded-lg text-white text-sm" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} />
              <button type="submit" className="bg-yellow-600 text-slate-900 font-black px-4 rounded-lg text-xs uppercase">Acessar</button>
            </form>
          ) : (
            <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                <h3 className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-2">Cadastrar Membro (Total 9)</h3>
                <div className="flex gap-2">
                  <input type="text" placeholder="Nome" className="flex-1 bg-slate-900 border border-slate-600 p-2 rounded-lg text-white text-sm" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddAgent()} />
                  <button onClick={handleAddAgent} className="bg-emerald-600 p-2 rounded-lg"><Plus size={18} /></button>
                </div>
              </div>
              <div className="flex-1 max-h-32 overflow-y-auto grid grid-cols-2 gap-2 custom-scrollbar">
                {agents.map(a => (
                  <div key={a.id} className="flex justify-between items-center bg-slate-900 p-2 rounded-lg text-[10px] border border-slate-700 uppercase font-bold">
                    <span className="truncate">{a.name}</span>
                    <button onClick={() => { if(confirm('Excluir?') && db) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agents', a.id)) }} className="text-red-500"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MAIN */}
      <main className="flex-1 flex flex-col lg:flex-row gap-2 p-2 overflow-hidden">
        
        {/* FILA DE PRIORIDADE */}
        <aside className="w-full lg:w-72 bg-slate-800 rounded-2xl border border-slate-700 flex flex-col shadow-2xl overflow-hidden h-64 lg:h-auto">
          <div className="bg-slate-900 p-3 border-b border-slate-700">
            <h2 className="text-[10px] font-black text-emerald-400 flex items-center gap-2 tracking-[0.2em]">
              <ListFilter size={14} /> FILA DE RODÍZIO
            </h2>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-slate-700/50 custom-scrollbar">
            {agentRanking.map((agent, index) => (
              <div key={agent.id} className={`p-3 flex items-center justify-between transition-all ${index === 0 ? 'bg-emerald-900/20 ring-1 ring-inset ring-emerald-500/30' : ''} ${agent.isDoneInCurrentCycle ? 'opacity-40 grayscale-[0.5]' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-black ${index === 0 ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-400'}`}>
                    {index + 1}
                  </div>
                  <div className="flex flex-col">
                    <span className={`text-xs font-black uppercase tracking-tight ${index === 0 ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {agent.name}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {agent.isDoneInCurrentCycle ? (
                        <span className="text-[7px] bg-slate-700 px-1 rounded text-slate-400 font-bold uppercase">Ciclo OK</span>
                      ) : (
                        <span className="text-[7px] bg-emerald-900/40 px-1 rounded text-emerald-500 font-bold uppercase">Aguardando</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black text-white block">{agent.balance}</span>
                  <span className="text-[7px] text-slate-500 font-black uppercase">Saldo</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* CALENDÁRIO */}
        <div className="flex-1 bg-slate-800/50 rounded-2xl border border-slate-700 p-2 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-2">
            {getCycleDates(viewDate).dates.map((date) => {
              const team = getTeamForDate(date);
              const isSun = date.getDay() === 0;
              const isSat = date.getDay() === 6;
              const dayAssignments = assignments.filter(a => a.status !== 'refused' && new Date(a.date).toDateString() === date.toDateString());

              return (
                <div key={date.toISOString()} className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col min-h-[140px] shadow-sm hover:border-yellow-500/30 transition-all">
                  <div className={`px-2 py-2 flex justify-between items-center border-b border-slate-700 ${isSun ? 'bg-red-900/10 text-red-400' : ''} ${isSat ? 'bg-blue-900/10 text-blue-400' : ''}`}>
                    <div className="flex items-baseline gap-1">
                      <span className="font-black text-xl leading-none">{date.getDate()}</span>
                      <span className="text-[8px] font-black uppercase opacity-50">{getDayOfWeek(date)}</span>
                    </div>
                    <div className={`text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm ${team === 'DELTA' ? 'bg-yellow-500 text-slate-900' : 'bg-slate-700 text-slate-400'}`}>{team}</div>
                  </div>
                  <div className="flex-1 p-1.5 space-y-1.5 overflow-y-auto custom-scrollbar">
                    {dayAssignments.map(a => (
                      <div key={a.id} className="bg-slate-900/80 rounded-lg px-2 py-1.5 text-[10px] border border-slate-700/50 flex justify-between items-center group animate-in fade-in">
                        <span className="truncate flex-1 font-bold uppercase">{agents.find(ag => ag.id === a.agentId)?.name || '...'}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-black ${a.type === 'Diurno' ? 'text-yellow-500' : 'text-indigo-400'}`}>{a.type === 'Diurno' ? 'D' : 'N'}</span>
                          <button onClick={() => { if(confirm('Apagar?') && db) deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'assignments', a.id)) }} className="opacity-0 group-hover:opacity-100 text-red-500 transition-all"><Trash2 size={12} /></button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setSelectedDate(date)} className="w-full py-2 mt-1 text-[8px] font-black uppercase tracking-widest border border-dashed border-slate-700 text-slate-500 hover:border-yellow-500 hover:text-yellow-500 rounded-lg flex items-center justify-center gap-2 transition-all"><Plus size={12} /> Escalar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* MODAL RODÍZIO */}
      {selectedDate && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-slate-800 p-6 rounded-3xl border-2 border-yellow-500 w-full max-w-xs shadow-2xl relative animate-in zoom-in-95">
            <button onClick={() => setSelectedDate(null)} className="absolute top-4 right-4 text-slate-500 hover:text-white"><XCircle size={28} /></button>
            <h3 className="text-xl font-black text-white mb-1 tracking-tight uppercase">Ofertar Demanda</h3>
            <p className="text-[10px] text-yellow-500 font-black mb-6 uppercase tracking-widest">{formatDateBr(selectedDate)} • EQUIPE {getTeamForDate(selectedDate)}</p>
            
            <div className="space-y-5">
              <div className="p-3 bg-emerald-900/20 rounded-2xl border border-emerald-500/30 flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                <p className="text-[10px] text-emerald-300 font-black uppercase tracking-wider">Primeiro da Fila: <span className="text-white block text-sm mt-0.5">{agentRanking[0].name}</span></p>
              </div>
              
              <div>
                <label className="block text-[10px] text-slate-500 font-black uppercase mb-1.5 ml-1">Quem vai responder?</label>
                <select className="w-full bg-slate-900 border-2 border-slate-700 p-3 rounded-2xl text-white text-sm outline-none focus:border-yellow-500 transition-all appearance-none uppercase font-bold" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
                  <option value="">Selecione o Agente...</option>
                  {agentRanking.map((agent, i) => (
                    <option key={agent.id} value={agent.id} className={agent.isDoneInCurrentCycle ? 'text-slate-500' : 'text-white'}>
                      {i + 1}º - {agent.name} {agent.isDoneInCurrentCycle ? '(JÁ TEVE VEZ)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setBhType('Diurno')} className={`flex-1 py-3 rounded-xl border-2 text-[10px] font-black transition-all ${bhType === 'Diurno' ? 'bg-yellow-500 text-slate-900 border-yellow-400' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>DIURNO</button>
                <button onClick={() => setBhType('Noturno')} className={`flex-1 py-3 rounded-xl border-2 text-[10px] font-black transition-all ${bhType === 'Noturno' ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>NOTURNO</button>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => handleAssignment('accepted')} disabled={!selectedAgentId} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl text-[10px] tracking-widest disabled:opacity-20 transition-all active:scale-95 shadow-lg shadow-emerald-900/40 uppercase">Aceitou</button>
                <button onClick={() => handleAssignment('refused')} disabled={!selectedAgentId} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black py-4 rounded-2xl text-[10px] tracking-widest disabled:opacity-20 transition-all active:scale-95 shadow-lg shadow-red-900/40 uppercase">Recusou</button>
              </div>
              
              <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700">
                <p className="text-[8px] text-slate-400 uppercase font-bold leading-tight">
                  <span className="text-emerald-500">Aceitou:</span> Ganha hora e vai para o fim da fila.<br/>
                  <span className="text-red-500">Recusou:</span> Fila entende que teve a chance, mas não ganha hora (mantém prioridade de saldo).<br/>
                  <span className="text-yellow-500">Não respondeu:</span> Apenas feche o modal e escolha o próximo. O "pulado" mantém o topo.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-in { animation: fade-in 0.3s ease-out; }
      `}} />
    </div>
  );
}
