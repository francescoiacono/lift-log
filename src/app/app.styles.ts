import { css } from "styled-system/css";

export const styles = {
  shell: css({
    boxSizing: "border-box",
    minBlockSize: "100svh",
    display: "grid",
    placeItems: "center",
    paddingInline: "24px",
    paddingBlock: "24px",
    bg: "bg",
  }),
  title: css({
    m: "0",
    color: "fg",
    fontSize: {
      base: "48px",
      sm: "64px",
    },
    fontWeight: "700",
    lineHeight: "1",
  }),
};
