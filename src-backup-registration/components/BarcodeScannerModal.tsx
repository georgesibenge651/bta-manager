import React, { useState } from 'react';
import { Camera, Search, X, Check, Barcode } from 'lucide-react';
import { Product } from '../types';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  products: Product[];
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  products,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [isSimulatingCamera, setIsSimulatingCamera] = useState(true);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      playBeep();
      onScan(manualCode.trim());
      setManualCode('');
      onClose();
    }
  };

  const handleSelectProductBarcode = (barcode: string) => {
    playBeep();
    onScan(barcode);
    onClose();
  };

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 1400;
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      setTimeout(() => {
        osc.stop();
        audioCtx.close();
      }, 100);
    } catch {
      // AudioContext not allowed or supported
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="bg-[#0F2444] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Barcode className="w-6 h-6 text-sky-400" />
            <div>
              <h3 className="font-bold text-base">Scanner Code-barres</h3>
              <p className="text-xs text-slate-300">Caméra & Douchette laser</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera simulation box */}
        <div className="p-4 space-y-4">
          <div className="relative bg-slate-950 rounded-2xl h-48 overflow-hidden flex flex-col items-center justify-center border-2 border-dashed border-sky-400/60 shadow-inner">
            {/* Animated laser scan line */}
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 flex items-center justify-center">
              <div className="w-full h-0.5 bg-red-500 shadow-[0_0_12px_#ef4444] animate-pulse"></div>
            </div>
            
            {/* Viewfinder brackets */}
            <div className="absolute inset-6 border-2 border-sky-400/50 rounded-xl pointer-events-none flex flex-col justify-between">
              <div className="flex justify-between p-2">
                <span className="w-4 h-4 border-t-2 border-l-2 border-sky-400"></span>
                <span className="w-4 h-4 border-t-2 border-r-2 border-sky-400"></span>
              </div>
              <div className="flex justify-between p-2">
                <span className="w-4 h-4 border-b-2 border-l-2 border-sky-400"></span>
                <span className="w-4 h-4 border-b-2 border-r-2 border-sky-400"></span>
              </div>
            </div>

            <Camera className="w-10 h-10 text-sky-400/40 mb-2 animate-bounce" />
            <p className="text-xs text-sky-200 font-medium z-10 px-4 text-center">
              Pointez la caméra vers le code-barres ou le SKU
            </p>
            <span className="mt-1 text-[10px] text-slate-400 bg-white/10 px-2 py-0.5 rounded-full">
              Mode détection automatique activé
            </span>
          </div>

          {/* Manual Entry */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Ou saisir le code / SKU..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-none"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1 shadow-sm transition"
            >
              <Check className="w-4 h-4" />
              Valider
            </button>
          </form>

          {/* Quick Click Demo Barcodes from inventory */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Codes du magasin (clic rapide) :
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {products.slice(0, 6).map((prod) => (
                <button
                  key={prod.id}
                  onClick={() => handleSelectProductBarcode(prod.barcode)}
                  className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-sky-50 hover:border-sky-300 border border-slate-200 flex items-center justify-between transition-colors group"
                >
                  <div className="truncate pr-2">
                    <p className="font-semibold text-slate-800 truncate group-hover:text-sky-700">
                      {prod.name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {prod.sku} • {prod.barcode}
                    </p>
                  </div>
                  <span className="bg-sky-100 text-sky-800 text-[10px] px-2 py-0.5 rounded-md font-mono shrink-0">
                    Scanner
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 px-4 py-1.5"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
