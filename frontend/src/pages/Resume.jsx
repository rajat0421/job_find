import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';
import SkillTagInput from '../components/SkillTagInput';
import RoleSelector from '../components/RoleSelector';

const inputCls = 'w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition';
const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

// Lightweight chip input (locations, education)
const TagInput = ({ label, hint, placeholder, tags, onChange }) => {
  const [input, setInput] = useState('');
  const add = () => { const v = input.trim(); if (v && !tags.includes(v)) onChange([...tags, v]); setInput(''); };
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {hint && <p className="text-xs text-slate-600 mb-2">{hint}</p>}
      <div className="flex gap-2">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className={inputCls} placeholder={placeholder} />
        <button type="button" onClick={add} className="px-4 py-2.5 bg-white/5 border border-white/10 text-slate-300 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors">Add</button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 bg-violet-600/15 text-violet-300 border border-violet-500/20 text-xs font-medium px-2.5 py-1 rounded-full">
              {t}<button onClick={() => onChange(tags.filter((x) => x !== t))} className="hover:text-white leading-none">&times;</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const emptyForm = { name: '', email: '', phone: '', summary: '', skills: [], desiredRoles: [], experienceYears: 0, locations: [], education: [], projects: [], certifications: [] };

const Resume = () => {
  const { user, login, token } = useAuth();
  const [step, setStep] = useState('upload'); // upload | parsing | review | done
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const [resumeProfileId, setResumeProfileId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef(null);

  // Load a previous parse (if any) so returning users can re-review/edit
  useEffect(() => {
    api.get('/resume').then((res) => {
      const d = res.data;
      setForm({ ...emptyForm, ...d.parsed });
      setResumeProfileId(d.resumeProfileId);
      setFileName(d.fileName || '');
      setStep('review');
    }).catch(() => {});
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('File exceeds the 5 MB limit'); return; }
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Only PDF and DOCX files are supported'); return; }

    setFileName(file.name);
    setStep('parsing');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/resume/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm({ ...emptyForm, ...res.data.parsed });
      setResumeProfileId(res.data.resumeProfileId);
      setFromCache(res.data.fromCache);
      setStep('review');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to parse resume');
      setStep('upload');
    }
  };

  const handleConfirm = async () => {
    setConfirming(true); setError('');
    try {
      await api.put('/resume/confirm', {
        resumeProfileId,
        name: form.name,
        skills: form.skills,
        desiredRoles: form.desiredRoles,
        experienceYears: form.experienceYears,
        locations: form.locations,
        education: form.education,
      });
      login(token, { ...user, name: form.name });
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally { setConfirming(false); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Resume autofill</h1>
          <p className="text-sm text-slate-500 mt-0.5">Upload your resume and we'll extract your profile with AI. You review everything before it's saved.</p>
        </div>

        {/* Upload */}
        {step === 'upload' && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-8">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              className="border-2 border-dashed border-white/15 rounded-xl p-10 text-center cursor-pointer hover:border-violet-500/50 hover:bg-white/[0.02] transition-colors"
            >
              <p className="text-slate-300 font-medium">Drop your resume here, or click to browse</p>
              <p className="text-xs text-slate-600 mt-1.5">PDF or DOCX · max 5 MB</p>
              <input ref={fileRef} type="file" accept=".pdf,.docx" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])} />
            </div>
            {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
          </div>
        )}

        {/* Parsing */}
        {step === 'parsing' && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-12 text-center">
            <div className="text-3xl animate-spin mb-4 text-violet-400">⟳</div>
            <p className="text-slate-300 font-medium">Reading {fileName}…</p>
            <p className="text-xs text-slate-600 mt-1.5">Extracting your skills, experience and roles</p>
          </div>
        )}

        {/* Review */}
        {step === 'review' && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-7">
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm text-slate-400">Review &amp; edit — this will <span className="text-white font-medium">replace</span> your current profile.</p>
              {fromCache && <span className="text-xs text-slate-600">reused cached parse</span>}
            </div>

            <div className="flex flex-col gap-5">
              <div>
                <label className={labelCls}>Full name</label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your full name" />
              </div>

              {(form.email || form.phone) && (
                <div className="flex gap-3 text-xs text-slate-500">
                  {form.email && <span>✉ {form.email}</span>}
                  {form.phone && <span>☎ {form.phone}</span>}
                </div>
              )}

              <RoleSelector selected={form.desiredRoles} onChange={(desiredRoles) => setForm({ ...form, desiredRoles })} />

              <SkillTagInput label="Skills" tags={form.skills} onChange={(skills) => setForm({ ...form, skills })} />

              <div>
                <label className={labelCls}>Years of experience</label>
                <input type="number" min="0" className={inputCls} value={form.experienceYears}
                  onChange={(e) => setForm({ ...form, experienceYears: e.target.value })} />
              </div>

              <TagInput label="Preferred locations" placeholder="e.g. Bangalore, Remote…" tags={form.locations} onChange={(locations) => setForm({ ...form, locations })} />

              <TagInput label="Education" hint="Highest qualification is used on your profile" placeholder="e.g. B.E Computer Science, VIT" tags={form.education} onChange={(education) => setForm({ ...form, education })} />

              {form.projects?.length > 0 && (
                <div>
                  <label className={labelCls}>Projects <span className="text-slate-600 font-normal">(kept on file)</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {form.projects.map((p) => <span key={p} className="text-xs bg-white/5 text-slate-400 px-2.5 py-1 rounded-full">{p}</span>)}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 mt-1">
                <button onClick={handleConfirm} disabled={confirming}
                  className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50">
                  {confirming ? 'Saving…' : 'Confirm & save to profile'}
                </button>
                <button onClick={() => { setStep('upload'); setError(''); }}
                  className="px-4 py-2.5 border border-white/10 text-slate-400 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors">
                  Re-upload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-10 text-center">
            <div className="text-3xl mb-3 text-emerald-400">✓</div>
            <p className="text-white font-semibold">Profile updated from your resume</p>
            <p className="text-sm text-slate-500 mt-1">We'll start matching jobs to your new profile.</p>
            <Link to="/dashboard" className="inline-block mt-5 bg-violet-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors">
              Go to dashboard →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default Resume;
