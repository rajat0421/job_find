import { createContext, useContext, useRef, useState, useCallback } from 'react';

// Shared "is the account-settings modal open" state (navbar redesign
// follow-up). A single <AccountSettingsModal /> is rendered once, at the app
// root (see App.jsx), overlaying whatever route is currently mounted — this
// is what lets "Account settings" open the SAME modal from Home, Profile, or
// Resume without navigating anywhere or duplicating the modal per route.
const AccountModalContext = createContext(null);

export const AccountModalProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  // The element that opened the modal (the navbar's account-menu button) —
  // focus is restored here when the modal closes, per the accessibility
  // requirement. A ref, not state: it never needs to trigger a re-render.
  const triggerRef = useRef(null);

  const open = useCallback((triggerEl) => {
    triggerRef.current = triggerEl || null;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus?.();
  }, []);

  return (
    <AccountModalContext.Provider value={{ isOpen, open, close }}>
      {children}
    </AccountModalContext.Provider>
  );
};

export const useAccountModal = () => useContext(AccountModalContext);
