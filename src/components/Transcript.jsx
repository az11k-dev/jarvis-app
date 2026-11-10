import React, { useRef } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import HudCorners from './hud/HudCorners';
import { COLORS, FONTS } from '../styles/mainStyles';

const LABELS = { user: 'YOU', jarvis: 'J.A.R.V.I.S.', error: 'SYSTEM' };

const pad = (n) => String(n).padStart(2, '0');
const timeOf = (at) => {
  if (!at) return '';
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function Transcript({ messages }) {
  const scrollRef = useRef(null);

  const copy = (text) => {
    Clipboard.setStringAsync(text);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Copied', ToastAndroid.SHORT);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.sectionRow}>
        <View style={styles.sectionTick} />
        <Text style={styles.sectionLabel}>LOG</Text>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionCount}>{pad(messages.length)}</Text>
      </View>

      {!messages.length ? (
        <View style={styles.empty}>
          <View style={styles.hintBox}>
            <HudCorners color={COLORS.cyanSoft} size={8} />
            <Text style={styles.hintCaption}>VOICE COMMAND</Text>
            <Text style={styles.hint}>
              “Jarvis, what’s the weather in Tashkent?”
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.map((m) => (
            <Entry key={m.id} message={m} onCopy={copy} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Entry({ message: m, onCopy }) {
  const isUser = m.role === 'user';
  const accent =
    m.role === 'error' ? COLORS.danger : isUser ? COLORS.muted : COLORS.cyan;
  return (
    <View
      style={[
        styles.entry,
        isUser ? styles.entryUser : styles.entryJarvis,
        { borderColor: accent },
      ]}
    >
      <View style={[styles.labelRow, isUser && styles.labelRowUser]}>
        <Text
          style={[
            m.role === 'jarvis' ? styles.labelBrand : styles.label,
            { color: accent },
          ]}
        >
          {LABELS[m.role]}
        </Text>
        {!!m.at && <Text style={styles.time}>{timeOf(m.at)}</Text>}
      </View>
      <Text
        style={[styles.text, isUser && styles.textUser]}
        onLongPress={() => onCopy(m.text)}
      >
        {m.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, marginTop: 6 },
  sectionRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTick: {
    width: 6,
    height: 6,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    transform: [{ rotate: '45deg' }],
    marginRight: 8,
  },
  sectionLabel: {
    color: COLORS.cyanSoft,
    fontFamily: FONTS.bold,
    fontSize: 10,
    letterSpacing: 3,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.line,
    marginHorizontal: 10,
  },
  sectionCount: {
    color: COLORS.muted,
    fontFamily: FONTS.readout,
    fontSize: 9,
    letterSpacing: 2,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hintBox: { paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center' },
  hintCaption: {
    color: COLORS.muted,
    fontFamily: FONTS.bold,
    fontSize: 9,
    letterSpacing: 3,
    marginBottom: 8,
  },
  hint: {
    color: COLORS.textDim,
    fontFamily: FONTS.regular,
    fontSize: 15,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  list: { flex: 1 },
  listContent: { paddingTop: 14, paddingBottom: 8 },
  entry: { marginBottom: 16, paddingVertical: 2 },
  entryJarvis: {
    borderLeftWidth: 1.5,
    paddingLeft: 12,
    marginRight: 24,
  },
  entryUser: {
    borderRightWidth: 1.5,
    paddingRight: 12,
    marginLeft: 40,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  labelRowUser: { justifyContent: 'flex-end' },
  labelBrand: {
    fontFamily: FONTS.brand,
    fontSize: 8.5,
    letterSpacing: 2.5,
  },
  label: {
    fontFamily: FONTS.bold,
    fontSize: 10,
    letterSpacing: 2.5,
  },
  time: {
    marginLeft: 8,
    color: COLORS.muted,
    fontFamily: FONTS.readout,
    fontSize: 8,
    letterSpacing: 1.5,
  },
  text: {
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 16,
    lineHeight: 23,
  },
  textUser: { color: COLORS.textDim, textAlign: 'right' },
});
