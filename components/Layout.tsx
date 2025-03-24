import React from "react";
import styles from "../styles/chat.module.css";
import { Roboto } from 'next/font/google';

const roboto = Roboto({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className={`${styles.layout} ${roboto.className}`}>{children}</div>;
};

export default Layout;
