import React from "react";
import styles from "../styles/chat.module.css";

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className={styles.layout}>{children}</div>;
};

export default Layout;
