import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../services/api';

const Chip = ({ children }) => (
  <span className="text-xs bg-white/5 text-slate-300 px-2.5 py-1 rounded-full">{children}</span>
);

const Resume = () => {
  const { user, login, token } = useAuth();
  const [step, setStep] = useState('upload'); // upload | parsing | confirm | done
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [existing, setExisting] = useState(null); // { fileName, createdAt } of a previously uploaded resume
  const [parsed, setParsed] = useState(null); // extracted data awaiting confirmation
  const [resumeProfileId, setResumeProfileId] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef(null);

  // Just show what's on file already — no full edit form on load
  useEffect(() => {
    api.get('/resume').then((res) => {
      setExisting({ fileName: res.data.fileName, createdAt: res.data.createdAt });
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
      setParsed(res.data.parsed || {});
      setResumeProfileId(res.data.resumeProfileId);
      setStep('confirm');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to parse resume');
      setStep('upload');
    }
  };

  const handleConfirm = async () => {
    setConfirming(true); setError('');
    try {
      // Non-destructive on the backend: blank/missing fields leave the existing profile untouched
      await api.put('/resume/confirm', {
        resumeProfileId,
        name: parsed.name,
        skills: parsed.skills,
        desiredRoles: parsed.desiredRoles,
        experienceYears: parsed.experienceYears,
        locations: parsed.locations,
        education: parsed.education,
      });
      if (parsed.name) login(token, { ...user, name: parsed.name });
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setConfirming(false);
    }
  };

  const handleDiscard = () => {
    setParsed(null);
    setResumeProfileId(null);
    setError('');
    setStep('upload');
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Resume</h1>
          <p className="text-sm text-slate-500 mt-0.5">Upload your resume, review what we found, then confirm to update your profile.</p>
        </div>

        {/* Upload */}
        {step === 'upload' && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-8">
            {existing?.fileName && (
              <p className="text-xs text-slate-500 mb-4">
                On file: <span className="text-slate-300">{existing.fileName}</span>
                {existing.createdAt && ` · uploaded ${new Date(existing.createdAt).toLocaleDateString()}`}
              </p>
            )}
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

        {/* Confirm — read-only preview of what was extracted, nothing editable here */}
        {step === 'confirm' && parsed && (
          <div className="bg-[#12121c] border border-white/10 rounded-2xl p-7">
            <p className="text-sm text-slate-400 mb-5">
              Here's what we found in <span className="text-white font-medium">{fileName}</span>.
              Confirming will update your profile — existing fields are only overwritten where something new was detected.
            </p>

            <div className="flex flex-col gap-4">
              {parsed.name && (
                <div>
                  <p className="text-xs text-slate-600 mb-1.5">Name</p>
                  <p className="text-sm text-slate-200">{parsed.name}</p>
                </div>
              )}

              {parsed.desiredRoles?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 mb-1.5">Roles detected</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.desiredRoles.map((r) => <Chip key={r}>{r}</Chip>)}
                  </div>
                </div>
              )}

              {parsed.skills?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 mb-1.5">Skills detected</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.skills.map((s) => <Chip key={s}>{s}</Chip>)}
                  </div>
                </div>
              )}

              {parsed.experienceYears > 0 && (
                <div>
                  <p className="text-xs text-slate-600 mb-1.5">Experience</p>
                  <p className="text-sm text-slate-200">{parsed.experienceYears} years</p>
                </div>
              )}

              {parsed.locations?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 mb-1.5">Locations</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.locations.map((l) => <Chip key={l}>{l}</Chip>)}
                  </div>
                </div>
              )}

              {parsed.education?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 mb-1.5">Education</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.education.map((e) => <Chip key={e}>{e}</Chip>)}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 mt-1">
                <button onClick={handleConfirm} disabled={confirming}
                  className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50">
                  {confirming ? 'Saving…' : 'Confirm & save to profile'}
                </button>
                <button onClick={handleDiscard}
                  className="px-4 py-2.5 border border-white/10 text-slate-400 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors">
                  Discard
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
