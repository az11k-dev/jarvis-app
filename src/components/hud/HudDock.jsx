import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import HudCorners from './HudCorners';
import HudIcon from './HudIcon';
import { COLORS, FONTS } from '../../styles/mainStyles';

/**
 * Bottom control strip. items: [{ key, icon, label, onPress, tone, badge }]
 * tone: 'active' (lit cyan), 'alert' (red), or undefined (idle).
 */
export default function HudDock({ items }) {
  return (
    <View style={styles.dock}>
      <HudCorners size={9} />
      {items.map(({ key, ...item }, i) => (
        <React.Fragment key={key}>
          {i > 0 && <View style={styles.divider} />}
          <DockButton {...item} />
        </React.Fragment>
      ))}
    </View>
  );
}

function DockButton({ icon, label, onPress, tone, badge }) {
  const color =
    tone === 'active'
      ? COLORS.cyan
      : tone === 'alert'
        ? COLORS.danger
        : COLORS.textDim;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: 'rgba(79, 227, 255, 0.12)', borderless: false }}
      style={styles.button}
    >
      <View>
        <HudIcon name={icon} size={22} color={color} />
        {badge && <View style={[styles.badge, { backgroundColor: badge }]} />}
      </View>
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
      <View
        style={[
          styles.indicator,
          { backgroundColor: color, opacity: tone ? 1 : 0 },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panel,
  },
  divider: {
    width: 1,
    marginVertical: 14,
    backgroundColor: COLORS.line,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  label: {
    marginTop: 6,
    fontFamily: FONTS.bold,
    fontSize: 9.5,
    letterSpacing: 1.8,
  },
  indicator: {
    marginTop: 6,
    width: 14,
    height: 1.5,
  },
  badge: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
