interface IconProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function HIcon({ name, size = 16, color = 'currentColor', strokeWidth = 1.6, className }: IconProps) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };

  switch (name) {
    // navigation
    case 'chat':     return <svg {...p}><path d="M3 4h10v7H6l-3 2V4z"/></svg>;
    case 'board':    return <svg {...p}><rect x="2.5" y="3" width="3.5" height="10" rx="1"/><rect x="7" y="3" width="3.5" height="7" rx="1"/><rect x="11.5" y="3" width="2" height="5" rx="1"/></svg>;
    case 'clock':    return <svg {...p}><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>;
    case 'skills':   return <svg {...p}><path d="M3 5l5-2 5 2-5 2-5-2zM3 8l5 2 5-2M3 11l5 2 5-2"/></svg>;
    case 'memory':   return <svg {...p}><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 3v10M10 3v10M3 6h10M3 10h10"/></svg>;
    case 'activity': return <svg {...p}><path d="M2 8h3l2-4 3 8 2-4h2"/></svg>;
    case 'settings': return <svg {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>;
    case 'admin':    return <svg {...p}><circle cx="8" cy="5.5" r="2"/><path d="M3 13c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"/></svg>;

    // actions
    case 'plus':     return <svg {...p}><path d="M8 3v10M3 8h10"/></svg>;
    case 'send':     return <svg {...p}><path d="M2.5 8l11-5-4 11-2-5-5-1z"/></svg>;
    case 'search':   return <svg {...p}><circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/></svg>;
    case 'filter':   return <svg {...p}><path d="M2.5 4h11l-4 5v4l-3-1V9z"/></svg>;
    case 'share':    return <svg {...p}><circle cx="4" cy="8" r="1.5"/><circle cx="12" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M5.3 7.3l5.4-2.6M5.3 8.7l5.4 2.6"/></svg>;
    case 'copy':     return <svg {...p}><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10V4a1 1 0 011-1h6"/></svg>;
    case 'check':    return <svg {...p}><path d="M3 8.5l3 3 7-7"/></svg>;
    case 'x':        return <svg {...p}><path d="M4 4l8 8M12 4l-8 8"/></svg>;
    case 'chevron-right': return <svg {...p}><path d="M6 3l5 5-5 5"/></svg>;
    case 'chevron-down':  return <svg {...p}><path d="M3 6l5 5 5-5"/></svg>;
    case 'arrow-right':   return <svg {...p}><path d="M3 8h10M9 4l4 4-4 4"/></svg>;
    case 'arrow-down':    return <svg {...p}><path d="M8 2v10M4 8l4 4 4-4"/></svg>;
    case 'external': return <svg {...p}><path d="M9 3h4v4M13 3L7 9M11 9v3.5A.5.5 0 0110.5 13H4a1 1 0 01-1-1V5.5A.5.5 0 013.5 5H7"/></svg>;
    case 'download': return <svg {...p}><path d="M8 2v8M4 7l4 4 4-4M3 13h10"/></svg>;
    case 'retry':    return <svg {...p}><path d="M2 8a6 6 0 0111.5-2.3M14 8a6 6 0 01-11.5 2.3"/><path d="M13 3v3h-3M3 13v-3h3"/></svg>;
    case 'thumbs-up': return <svg {...p}><path d="M1 8.25a1.25 1.25 0 112.5 0v5a1.25 1.25 0 11-2.5 0v-5z"/><path d="M5 8V5.5a2 2 0 014 0V7h3.5a1.5 1.5 0 011.5 1.62l-.5 5A1.5 1.5 0 0112 15H5V8z"/></svg>;
    case 'thumbs-down': return <svg {...p}><path d="M1 5.75a1.25 1.25 0 102.5 0v-5a1.25 1.25 0 10-2.5 0v5z" transform="rotate(180 8 8)"/><path d="M5 8V5.5a2 2 0 014 0V7h3.5a1.5 1.5 0 011.5 1.62l-.5 5A1.5 1.5 0 0112 15H5V8z" transform="rotate(180 8 8)"/></svg>;
    case 'expand':   return <svg {...p}><path d="M10 2h4v4M6 14H2v-4M14 2L9 7M2 14l5-5"/></svg>;
    case 'collapse': return <svg {...p}><path d="M5 11H1v4M11 5h4V1M1 15l5-5M15 1l-5 5"/></svg>;

    // content kinds
    case 'doc':      return <svg {...p}><path d="M4 2h5l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v3h3M6 8h4M6 11h4"/></svg>;
    case 'artifact': return <svg {...p}><path d="M8 2l5 3v6l-5 3-5-3V5z"/><path d="M8 2v6M3 5l5 3 5-3"/></svg>;
    case 'dataset':  return <svg {...p}><ellipse cx="8" cy="4" rx="5" ry="1.7"/><path d="M3 4v4c0 .9 2.2 1.7 5 1.7s5-.8 5-1.7V4M3 8v4c0 .9 2.2 1.7 5 1.7s5-.8 5-1.7V8"/></svg>;
    case 'link':     return <svg {...p}><path d="M6.5 9.5L9.5 6.5M5.5 10.5a2.1 2.1 0 01-3-3l2-2a2.1 2.1 0 013 0M10.5 5.5a2.1 2.1 0 013 3l-2 2a2.1 2.1 0 01-3 0"/></svg>;
    case 'tool':     return <svg {...p}><path d="M10.5 3a2.5 2.5 0 00-2.5 3l-5 5 1.5 1.5 5-5a2.5 2.5 0 003-3l-1.4 1.4-1.1-1.1z"/></svg>;
    case 'sparkle':  return <svg {...p}><path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z"/></svg>;
    case 'bell':     return <svg {...p}><path d="M4 11V8a4 4 0 118 0v3l1 1H3z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></svg>;
    case 'lock':     return <svg {...p}><rect x="3" y="7" width="10" height="6" rx="1"/><path d="M5 7V5a3 3 0 116 0v2"/></svg>;
    case 'globe':    return <svg {...p}><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.8 2 1.8 9 0 11M8 2.5c-1.8 2-1.8 9 0 11"/></svg>;
    case 'team':     return <svg {...p}><circle cx="6" cy="6" r="2"/><circle cx="11.5" cy="6.5" r="1.5"/><path d="M2.5 13c0-2 1.6-3.5 3.5-3.5S9.5 11 9.5 13M10 13c0-1.5.7-2.5 2-2.5s2 1 2 2.5"/></svg>;
    case 'user':     return <svg {...p}><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"/></svg>;
    case 'play':     return <svg {...p}><path d="M5 3.5v9l7-4.5z"/></svg>;
    case 'pause':    return <svg {...p}><rect x="4.5" y="3.5" width="2" height="9" rx="0.5"/><rect x="9.5" y="3.5" width="2" height="9" rx="0.5"/></svg>;
    case 'dot':      return <svg {...p}><circle cx="8" cy="8" r="2" fill={color} stroke="none"/></svg>;
    case 'decisions': return <svg {...p}><path d="M8 2v4M8 10v4M4 8H2M14 8h-2M5 5L3.5 3.5M12.5 12.5L11 11M5 11l-1.5 1.5M12.5 3.5L11 5"/><circle cx="8" cy="8" r="2"/></svg>;
    default: return <svg {...p}/>;
  }
}
