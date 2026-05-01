import { Children, cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';

type Variant = 'fade-in' | 'fade-rise' | 'scale-in';

interface FadeInProps {
  children: ReactNode;
  variant?: Variant;
  delay?: number;
  className?: string;
}

const variantClass: Record<Variant, string> = {
  'fade-in':   'animate-fade-in',
  'fade-rise': 'animate-fade-rise',
  'scale-in':  'animate-scale-in',
};

export function FadeIn({
  children,
  variant = 'fade-rise',
  delay = 0,
  className = '',
}: FadeInProps) {
  return (
    <div
      className={`${variantClass[variant]} ${className}`.trim()}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

interface StaggerProps {
  children: ReactNode;
  step?: number;
  initialDelay?: number;
}

export function Stagger({ children, step = 40, initialDelay = 0 }: StaggerProps) {
  let i = 0;
  return (
    <>
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        const el = child as ReactElement<{ style?: CSSProperties }>;
        const existingStyle = el.props.style ?? {};
        const delay = initialDelay + i * step;
        i += 1;
        return cloneElement(el, {
          style: { ...existingStyle, animationDelay: `${delay}ms` },
        });
      })}
    </>
  );
}
