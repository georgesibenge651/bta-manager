import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, X, Delete, AlertCircle, KeyRound } from 'lucide-react';
import { User } from '../types';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser?: User | null;
  onSuccess: () => void;
  title?: string;
  description?: string;
  verifyPinFn: (pin: string) => boolean;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  onSuccess,
  title = 'Sécurité CHIEF ALPHONS COMPANY LTD – Code PIN Requis',
  description,
  verifyPinFn,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyPress = (num: string) => {
    if (pin.length < 8) {
      const next = pin + num;
      setPin(next);
      setError('');
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleValidate = () => {
    if (!pin) {
      setError('Veuillez saisir votre code PIN.');
      return;
    }
    const isValid = verifyPinFn(pin);
    if (isValid) {
      onSuccess();
      onClose();
    } else {
      setError('Code PIN incorrect. Veuillez réessayer.');
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-200 flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm">{title}</h3>
              <p className="text-[11px] text-sky-200">
                {targetUser ? `${targetUser.name} (${targetUser.role})` : description || 'Authentification requise'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* PIN Display Dots */}
        <div className="p-5 text-center space-y-4">
          <div className="flex justify-center items-center gap-3 py-2">
            {[0, 1, 2, 3].map((idx) => {
              const isFilled = pin.length > idx;
              return (
                <div
                  key={idx}
                  className={`w-4 h-4 rounded-full transition-all duration-150 ${
                    isFilled
                      ? 'bg-sky-600 scale-110 shadow-sm shadow-sky-500/50'
                      : 'border-2 border-slate-300 bg-slate-100'
                  }`}
                />
              );
            })}
          </div>

          {error && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-red-600 font-bold bg-red-50 py-1.5 px-3 rounded-xl border border-red-200">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleKeyPress(digit)}
                className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-sky-100 text-slate-800 font-black text-lg transition flex items-center justify-center select-none"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold text-xs transition flex items-center justify-center"
            >
              Effacer
            </button>
            <button
              type="button"
              onClick={() => handleKeyPress('0')}
              className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-sky-100 text-slate-800 font-black text-lg transition flex items-center justify-center select-none"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition flex items-center justify-center"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleValidate}
            disabled={pin.length < 4}
            className="w-full py-3 bg-[#0F2444] hover:bg-[#1E3E62] disabled:opacity-40 text-white rounded-2xl font-bold text-xs uppercase tracking-wider shadow-md transition flex items-center justify-center gap-1.5 mt-2"
          >
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            Valider le Code PIN
          </button>
        </div>
      </div>
    </div>
  );
};
