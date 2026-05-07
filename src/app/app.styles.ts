import { css } from "styled-system/css";

export const styles = {
  shell: css({
    boxSizing: "border-box",
    minH: "100svh",
    display: "grid",
    placeItems: "center",
    px: "24px",
    py: "24px",
  }),
  title: css({
    m: "0",
    color: "#111827",
    fontSize: {
      base: "48px",
      sm: "64px",
    },
    fontWeight: "700",
    lineHeight: "1",
  }),
};
