import React, { useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import HudCorners from './hud/HudCorners';
import HudIcon from './hud/HudIcon';
import { textInput } from '../services/textInput';
import { COLORS, FONTS } from '../styles/mainStyles';

/**
 * Text box for typing to JARVIS instead of speaking. Hidden by default:
 * JARVIS opens it when asked («Джарвис, открой ввод текста»); ✕ or
 * «Джарвис, закрой ввод текста» hides it again. What is sent runs exactly
 * like a spoken command.
 */
export default function TextInputBar({ onSend }) {
  const open = useSyncExternalStore(textInput.subscribe, textInput.getSnapshot);
  const [text, setText] = useState('');
  if (!open) return null;

  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    onSend(value);
  };

  return (
    <View style={styles.bar}>
      <HudCorners size={7} />
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        submitBehavior="submit"
        returnKeyType="send"
        placeholder="Write to JARVIS…"
        placeholderTextColor={COLORS.muted}
        selectionColor={COLORS.cyan}
        cursorColor={COLORS.cyan}
        autoFocus
        multiline={false}
      />
      <Pressable
        onPress={send}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Send"
        style={styles.button}
        disabled={!text.trim()}
      >
        <HudIcon
          name="send"
          size={20}
          color={text.trim() ? COLORS.cyan : COLORS.muted}
        />
      </Pressable>
      <Pressable
        onPress={() => {
          setText('');
          textInput.hide();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Close the text box"
        style={styles.button}
      >
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panel,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 15,
  },
  button: { paddingHorizontal: 8, paddingVertical: 8 },
  close: { color: COLORS.textDim, fontSize: 18 },
});
