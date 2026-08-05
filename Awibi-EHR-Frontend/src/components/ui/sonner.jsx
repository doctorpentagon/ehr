import { Toaster as Sonner } from 'sonner';

function Toaster({ ...props }) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={{ '--normal-bg': 'var(--popover)', '--normal-border': 'var(--border)', '--normal-text': 'var(--popover-foreground)' }}
      {...props}
    />
  );
}

export { Toaster };
