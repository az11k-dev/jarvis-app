import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../../styles/mainStyles';

/**
 * Four L-shaped brackets on the corners of the parent (which must not clip
 * them). The parent's own border, if any, stays faint; the brackets carry
 * the "targeting frame" look.
 */
export default function HudCorners({
  color = COLORS.cyan,
  size = 10,
  inset = -1,
}) {
  const base = { borderColor: color, width: size, height: size };
  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.c, base, { top: inset, left: inset }, styles.tl]}
      />
      <View
        pointerEvents="none"
        style={[styles.c, base, { top: inset, right: inset }, styles.tr]}
      />
      <View
        pointerEvents="none"
        style={[styles.c, base, { bottom: inset, left: inset }, styles.bl]}
      />
      <View
        pointerEvents="none"
        style={[styles.c, base, { bottom: inset, right: inset }, styles.br]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  c: { position: 'absolute' },
  tl: { borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  tr: { borderTopWidth: 1.5, borderRightWidth: 1.5 },
  bl: { borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  br: { borderBottomWidth: 1.5, borderRightWidth: 1.5 },
});
