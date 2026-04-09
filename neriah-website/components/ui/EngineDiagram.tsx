import Image from 'next/image'

interface Props {
  light?: boolean
}

export function EngineDiagram({ light = false }: Props) {
  const pillBase    = light
    ? 'bg-white border border-black/[0.08] text-dark shadow-sm hover:bg-gray-50'
    : 'bg-white/10 border border-white/[0.18] text-white hover:bg-white/[0.18]'
  const engineBox   = light
    ? 'bg-teal border-[1.5px] border-teal-dark'
    : 'bg-white/[0.12] border-[1.5px] border-teal-mid/50'
  const engineRing  = light ? 'border-teal-dark/20' : 'border-teal-mid/20'
  const resultCard  = light
    ? 'bg-white border border-black/[0.08] shadow-sm'
    : 'bg-white/10 border border-white/20'
  const resultLabel = light ? 'text-teal' : 'text-teal-mid'
  const resultValue = light ? 'text-dark'  : 'text-white'
  const resultItalic = light ? 'text-mid'  : 'text-white/75'
  const neriahPillLogo = light
    ? '/images/logo/logo-light-background.png'
    : '/images/logo/logo-dark-brackground.png'
  const trackColor  = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'
  const emailColor  = light ? '#0D7377'           : 'rgba(255,255,255,0.82)'

  return (
    <div className="flex flex-row items-center justify-center" aria-label="Submission and output flow for Neriah Engine">

      {/* Channel pills */}
      <div className="flex flex-col gap-4">
        {[
          {
            label: 'Email',
            cls: 'bg-teal-light',
            icon: (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="2.5" width="10" height="7" rx="1.5" stroke="#085041" strokeWidth="1.2"/>
                <path d="M1 4.5l5 3 5-3" stroke="#085041" strokeWidth="1.2"/>
              </svg>
            ),
          },
          {
            label: 'WhatsApp',
            cls: 'bg-[#25D366]',
            icon: (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path fill="white" d="M12 2C6.48 2 2 6.48 2 12c0 1.78.48 3.45 1.32 4.89L2 22l5.26-1.3A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.02 15.98a8.02 8.02 0 01-3.94-1.04l-.28-.17-2.9.73.75-2.78-.18-.29A8 8 0 014 12c0-4.42 3.6-8 8.02-8C16.42 4 20 7.58 20 12c0 4.42-3.58 8-7.98 8z"/>
                <path fill="white" d="M16.01 14.3c-.24-.12-1.4-.69-1.62-.77-.21-.08-.37-.12-.52.12-.15.24-.59.77-.73.93-.14.16-.27.18-.51.06-.24-.12-1-.37-1.9-1.18-.7-.62-1.17-1.4-1.31-1.64-.14-.24-.01-.36.1-.48.1-.11.24-.27.36-.4.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.52-1.25-.71-1.73-.18-.45-.37-.38-.52-.38h-.45c-.16 0-.4.06-.62.3-.21.24-.82.8-.82 1.96s.84 2.27.96 2.43c.12.16 1.66 2.54 4.02 3.55.56.24 1 .39 1.34.5.56.18 1.07.15 1.48.09.45-.07 1.38-.56 1.58-1.11.2-.55.2-1.01.14-1.11-.06-.1-.22-.16-.46-.28z"/>
              </svg>
            ),
          },
          {
            label: 'Neriah App',
            cls: 'bg-amber',
            icon: (
              <Image src={neriahPillLogo} alt="Neriah" width={18} height={18} className="w-[18px] h-[18px] object-contain" />
            ),
          },
        ].map(ch => (
          <div key={ch.label}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[11px] font-medium w-[130px] transition-colors ${pillBase}`}>
            <div className={`w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 ${ch.cls}`} aria-hidden="true">
              {ch.icon}
            </div>
            {ch.label}
          </div>
        ))}
      </div>

      <FunnelConnector trackColor={trackColor} emailColor={emailColor} />

      {/* Engine box */}
      <div className={`${engineBox} rounded-[14px] px-4 py-4 text-center w-[164px] relative flex-shrink-0`}
        role="img" aria-label="Neriah AI Engine">
        <div className={`absolute inset-[-4px] rounded-[17px] border ${engineRing} animate-engine-ring pointer-events-none`} aria-hidden="true" />
        <div className="flex justify-center mb-2">
          <Image
            src="/images/logo/logo-dark-brackground.png"
            alt="Neriah"
            width={56}
            height={19}
            className="h-[19px] w-auto"
          />
        </div>
        <p className="font-display text-[18px] font-bold text-white tracking-tight">Neriah Engine</p>
        <p className="text-[10px] text-teal-mid uppercase tracking-[0.6px] mt-0.5">AI grading</p>
        <div className="flex gap-[5px] justify-center mt-2.5" aria-hidden="true">
          {[0, 200, 400].map(d => (
            <div key={d} className="w-[5px] h-[5px] bg-teal-mid rounded-full animate-dot-pulse"
              style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>

      <SplitterConnector trackColor={trackColor} />

      {/* Result cards */}
      <div className="relative flex-shrink-0 w-[110px]" style={{ height: '134px' }}>

        <div className={`absolute left-0 w-full h-10 px-2.5 ${resultCard} rounded-lg flex flex-col justify-center gap-[2px]`}
          style={{ top: '0px' }} aria-label="Result: student grade">
          <p className={`text-[8px] ${resultLabel} uppercase tracking-[0.5px] font-medium leading-none`}>Student Grade</p>
          <div className="flex items-center gap-[3px]">
            <span className={`text-[14px] font-bold leading-none ${resultValue}`}>7/10</span>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
              <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        <div className={`absolute left-0 w-full h-10 px-2.5 ${resultCard} rounded-lg flex flex-col justify-center gap-[2px]`}
          style={{ top: '47px' }} aria-label="Result: analytics">
          <p className={`text-[8px] ${resultLabel} uppercase tracking-[0.5px] font-medium leading-none`}>Analytics</p>
          <div className="flex items-end gap-[3px]" style={{ height: '16px' }} aria-hidden="true">
            <div className="w-[6px] rounded-[1px] bg-teal-mid/50" style={{ height: '8px' }} />
            <div className="w-[6px] rounded-[1px] bg-teal-mid/75" style={{ height: '12px' }} />
            <div className="w-[6px] rounded-[1px] bg-teal-mid" style={{ height: '16px' }} />
          </div>
        </div>

        <div className={`absolute left-0 w-full h-10 px-2.5 ${resultCard} rounded-lg flex flex-col justify-center gap-[2px]`}
          style={{ top: '94px' }} aria-label="Result: comments">
          <p className={`text-[8px] ${resultLabel} uppercase tracking-[0.5px] font-medium leading-none`}>Comments</p>
          <p className={`text-[7.5px] italic leading-none ${resultItalic}`}>Well structured. Review Q3.</p>
        </div>

      </div>

      <style>{`
        @keyframes funnelEmail  { 0% { stroke-dashoffset: 2; } 100% { stroke-dashoffset: -114; } }
        @keyframes funnelWa     { 0% { stroke-dashoffset: 2; } 100% { stroke-dashoffset: -64;  } }
        @keyframes funnelNeriah { 0% { stroke-dashoffset: 2; } 100% { stroke-dashoffset: -114; } }
        @keyframes outTop       { 0% { stroke-dashoffset: 2; } 100% { stroke-dashoffset: -114; } }
        @keyframes outMid       { 0% { stroke-dashoffset: 2; } 100% { stroke-dashoffset: -64;  } }
        @keyframes outBot       { 0% { stroke-dashoffset: 2; } 100% { stroke-dashoffset: -114; } }
      `}</style>
    </div>
  )
}

function FunnelConnector({ trackColor, emailColor }: { trackColor: string; emailColor: string }) {
  const emailPath  = 'M 0,17 L 32,17 L 32,67 L 64,67'
  const waPath     = 'M 0,67 L 64,67'
  const neriahPath = 'M 0,117 L 32,117 L 32,67 L 64,67'

  return (
    <svg width="64" height="134" viewBox="0 0 64 134" className="flex-shrink-0 overflow-visible" aria-hidden="true">
      <path d={emailPath}  stroke={trackColor} strokeWidth="1.5" fill="none" />
      <path d={waPath}     stroke={trackColor} strokeWidth="1.5" fill="none" />
      <path d={neriahPath} stroke={trackColor} strokeWidth="1.5" fill="none" />

      {[0, 1, 2].map((delay, i) => (
        <path key={i} d={emailPath} stroke={emailColor} strokeWidth="1.5" strokeLinecap="round" fill="none"
          strokeDasharray="2 114" style={{ animation: `funnelEmail 3s linear ${delay}s infinite`, animationFillMode: 'backwards' }} />
      ))}
      {[0, 1, 2].map((delay, i) => (
        <path key={i} d={waPath} stroke="#25D366" strokeWidth="1.5" strokeLinecap="round" fill="none"
          strokeDasharray="2 64" style={{ animation: `funnelWa 3s linear ${delay}s infinite`, animationFillMode: 'backwards' }} />
      ))}
      {[0, 1, 2].map((delay, i) => (
        <path key={i} d={neriahPath} stroke="#F5A623" strokeWidth="1.5" strokeLinecap="round" fill="none"
          strokeDasharray="2 114" style={{ animation: `funnelNeriah 3s linear ${delay}s infinite`, animationFillMode: 'backwards' }} />
      ))}
    </svg>
  )
}

function SplitterConnector({ trackColor }: { trackColor: string }) {
  const topPath = 'M 0,67 L 32,67 L 32,17 L 64,17'
  const midPath = 'M 0,67 L 64,67'
  const botPath = 'M 0,67 L 32,67 L 32,117 L 64,117'

  return (
    <svg width="64" height="134" viewBox="0 0 64 134" className="flex-shrink-0 overflow-visible" aria-hidden="true">
      <path d={topPath} stroke={trackColor} strokeWidth="1.5" fill="none" />
      <path d={midPath} stroke={trackColor} strokeWidth="1.5" fill="none" />
      <path d={botPath} stroke={trackColor} strokeWidth="1.5" fill="none" />

      {[0, 1, 2].map((delay, i) => (
        <path key={i} d={topPath} stroke="#F5A623" strokeWidth="1.5" strokeLinecap="round" fill="none"
          strokeDasharray="2 114" style={{ animation: `outTop 3s linear ${delay}s infinite`, animationFillMode: 'backwards' }} />
      ))}
      {[0, 1, 2].map((delay, i) => (
        <path key={i} d={midPath} stroke="#F5A623" strokeWidth="1.5" strokeLinecap="round" fill="none"
          strokeDasharray="2 64" style={{ animation: `outMid 3s linear ${delay}s infinite`, animationFillMode: 'backwards' }} />
      ))}
      {[0, 1, 2].map((delay, i) => (
        <path key={i} d={botPath} stroke="#F5A623" strokeWidth="1.5" strokeLinecap="round" fill="none"
          strokeDasharray="2 114" style={{ animation: `outBot 3s linear ${delay}s infinite`, animationFillMode: 'backwards' }} />
      ))}
    </svg>
  )
}
