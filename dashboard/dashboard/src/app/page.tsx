'use client';
import { useState, useEffect } from 'react';
import { Play, Clock, Activity, Settings, Terminal, CheckCircle2, AlertCircle, Bot, X } from 'lucide-react';

export default function Dashboard() {
  const [status, setStatus] = useState<any>(null);
  const [cronJobs, setCronJobs] = useState<any[]>([]);
  const [prompt, setPrompt] = useState('');
  const [cronSchedule, setCronSchedule] = useState('0 * * * *');
  const [cronPrompt, setCronPrompt] = useState('');
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchCron();
    const interval = setInterval(() => fetchStatus(), 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/status');
      setStatus(await res.json());
    } catch (e) {
      setStatus({ status: 'offline', uptime: '00:00:00' });
    }
  };

  const fetchCron = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/cron');
      setCronJobs(await res.json());
    } catch (e) {}
  };

  const handleExecute = async () => {
    if (!prompt) return;
    setExecuting(true);
    try {
      await fetch('http://localhost:3000/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, isAsync: true })
      });
      setPrompt('');
    } catch (e) {}
    setExecuting(false);
  };

  const handleAddCron = async () => {
    if (!cronSchedule || !cronPrompt) return;
    try {
      await fetch('http://localhost:3000/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: cronSchedule, prompt: cronPrompt })
      });
      setCronSchedule('0 * * * *');
      setCronPrompt('');
      fetchCron();
    } catch (e) {}
  };

  const handleDeleteCron = async (id: string) => {
    try {
      await fetch(`http://localhost:3000/api/cron/${id}`, { method: 'DELETE' });
      fetchCron();
    } catch (e) {}
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-gray-200 font-sans p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 pb-6">
          <div className="flex items-center space-x-4">
            <Bot size={32} className="text-emerald-500" />
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">AURIX <span className="text-emerald-500">v3</span></h1>
              <p className="text-sm text-gray-500">Autonomous Multi-Agent Workspace</p>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 bg-gray-900 px-4 py-2 rounded-lg border border-gray-800">
              <Activity size={18} className={status?.status === 'online' ? 'text-emerald-500' : 'text-red-500'} />
              <span className="font-mono text-sm">{status?.status === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <div className="flex items-center space-x-2 bg-gray-900 px-4 py-2 rounded-lg border border-gray-800">
              <Clock size={18} className="text-blue-400" />
              <span className="font-mono text-sm">{status?.uptime || '00:00:00'}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Execution Area */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-2xl">
              <div className="flex items-center space-x-2 mb-4">
                <Terminal size={20} className="text-gray-400" />
                <h2 className="text-lg font-semibold text-white">Manual Execution</h2>
              </div>
              <p className="text-sm text-gray-400 mb-4">Trigger an agent task directly from the dashboard. The task will run autonomously in the background.</p>
              
              <div className="relative">
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="E.g., 'Scrape the front page of HackerNews and save it to hn.txt'"
                  className="w-full bg-[#111] border border-gray-800 text-gray-200 p-4 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 min-h-[120px] resize-none font-mono text-sm"
                />
              </div>
              <div className="mt-4 flex justify-end">
                <button 
                  onClick={handleExecute}
                  disabled={!prompt || executing || status?.status !== 'online'}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg flex items-center space-x-2 transition-colors font-medium"
                >
                  <Play size={18} />
                  <span>Execute Task</span>
                </button>
              </div>
            </div>

            {/* Logs Placeholder */}
            <div className="bg-black border border-gray-800 rounded-xl p-6 h-64 font-mono text-sm overflow-hidden flex flex-col relative">
              <div className="flex items-center justify-between mb-4 border-b border-gray-800 pb-2">
                <span className="text-gray-500">Live Execution Logs</span>
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">Read-only</span>
              </div>
              <div className="flex-1 flex items-center justify-center text-gray-600">
                Live streaming logs will be implemented in v3.1
              </div>
            </div>
          </div>

          {/* Sidebar - Cron Daemon */}
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center space-x-2 mb-6 border-b border-gray-800 pb-4">
                <Settings size={20} className="text-purple-400" />
                <h2 className="text-lg font-semibold text-white">Cron Daemon</h2>
              </div>
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Schedule (Cron syntax)</label>
                  <input 
                    type="text" 
                    value={cronSchedule}
                    onChange={(e) => setCronSchedule(e.target.value)}
                    placeholder="0 * * * *"
                    className="w-full bg-[#111] border border-gray-800 p-2 rounded focus:outline-none focus:border-purple-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Agent Prompt</label>
                  <input 
                    type="text" 
                    value={cronPrompt}
                    onChange={(e) => setCronPrompt(e.target.value)}
                    placeholder="E.g., Check server logs"
                    className="w-full bg-[#111] border border-gray-800 p-2 rounded focus:outline-none focus:border-purple-500 font-mono text-sm"
                  />
                </div>
                <button 
                  onClick={handleAddCron}
                  disabled={!cronSchedule || !cronPrompt}
                  className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white py-2 rounded transition-colors text-sm font-medium"
                >
                  Add Trigger
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Active Jobs ({cronJobs.length})</h3>
                {cronJobs.length === 0 ? (
                  <p className="text-sm text-gray-600 italic">No scheduled tasks</p>
                ) : (
                  cronJobs.map(job => (
                    <div key={job.id} className="bg-[#111] border border-gray-800 p-3 rounded flex justify-between items-start group">
                      <div className="overflow-hidden pr-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-purple-400 font-mono text-xs font-bold">{job.schedule}</span>
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        </div>
                        <p className="text-sm text-gray-300 truncate mt-1" title={job.prompt}>{job.prompt}</p>
                      </div>
                      <button onClick={() => handleDeleteCron(job.id)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
