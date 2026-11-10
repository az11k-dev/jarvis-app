import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Telegram from '../services/telegram';
import HudCorners from './hud/HudCorners';
import { COLORS, styles } from '../styles/mainStyles';

const CODE_SOURCE = {
  authenticationCodeTypeTelegramMessage:
    'The code was sent to Telegram on your other device.',
  authenticationCodeTypeSms: 'The code was sent by SMS.',
  authenticationCodeTypeCall: 'You’ll get a call that reads out the code.',
  authenticationCodeTypeFlashCall:
    'You’ll get a call — the code is in the caller’s number.',
};

export function useTelegramState() {
  const [state, setState] = useState(Telegram.getState);
  useEffect(() => Telegram.subscribe(setState), []);
  return state;
}

/** One-time login to Telegram as the user: phone → code → 2FA password. */
export default function TelegramModal({ isVisible, onClose }) {
  const state = useTelegramState();

  return (
    <Modal
      animationType="slide"
      transparent
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <HudCorners />
          <Text style={styles.modalTitle}>Telegram</Text>
          <View style={styles.modalTitleRule} />
          <Body state={state} />
          {state.error && <Text style={styles.errorText}>{state.error}</Text>}
          <TouchableOpacity style={styles.closeModalButton} onPress={onClose}>
            <Text style={styles.closeModalButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Body({ state }) {
  switch (state.step) {
    case 'unavailable':
      return (
        <Text style={styles.tgText}>
          Telegram isn’t set up. Add EXPO_PUBLIC_TG_API_ID and
          EXPO_PUBLIC_TG_API_HASH to .env (my.telegram.org) and rebuild the app.
          Android only.
        </Text>
      );
    case 'loading':
      return <ActivityIndicator color={COLORS.cyan} style={{ margin: 20 }} />;
    case 'unsupported':
      return <Text style={styles.tgText}>{state.message}</Text>;
    case 'ready':
      return (
        <>
          <Text style={styles.tgText}>
            Signed in as {Telegram.displayName(state.me) || '…'}
          </Text>
          <TgButton
            label="Log out of Telegram"
            busy={state.busy}
            onPress={Telegram.logOut}
          />
        </>
      );
    case 'phone':
      return (
        <Step
          key="phone"
          hint="Sign in to your account. JARVIS will read and send messages on your behalf."
          placeholder="+998 90 123 45 67"
          keyboardType="phone-pad"
          autoComplete="tel"
          label="Get code"
          busy={state.busy}
          onSubmit={Telegram.submitPhone}
        />
      );
    case 'code':
      return (
        <>
          <Step
            key="code"
            hint={CODE_SOURCE[state.codeType] || 'Enter the confirmation code.'}
            placeholder="Code"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            label="Sign in"
            busy={state.busy}
            onSubmit={Telegram.submitCode}
          />
          <TouchableOpacity onPress={Telegram.resendCode} disabled={state.busy}>
            <Text style={styles.tgLink}>Resend code</Text>
          </TouchableOpacity>
        </>
      );
    case 'password':
      return (
        <Step
          key="password"
          hint={
            state.passwordHint
              ? `Cloud password (hint: ${state.passwordHint})`
              : 'Cloud password (two-step verification)'
          }
          placeholder="Password"
          secureTextEntry
          label="Sign in"
          busy={state.busy}
          onSubmit={Telegram.submitPassword}
        />
      );
    default:
      return null;
  }
}

// Keyed by step in Body's output, so every step starts with an empty field.
function Step({ hint, label, busy, onSubmit, ...inputProps }) {
  const [input, setInput] = useState('');
  const submit = () => input && onSubmit(input);
  return (
    <>
      <Text style={styles.tgText}>{hint}</Text>
      <TextInput
        style={styles.tgInput}
        value={input}
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholderTextColor={COLORS.muted}
        autoFocus
        editable={!busy}
        {...inputProps}
      />
      <TgButton label={label} busy={busy} disabled={!input} onPress={submit} />
    </>
  );
}

function TgButton({ label, busy, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.tgButton, (busy || disabled) && styles.tgButtonDisabled]}
      onPress={onPress}
      disabled={busy || disabled}
    >
      {busy ? (
        <ActivityIndicator color={COLORS.cyan} />
      ) : (
        <Text style={styles.tgButtonText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}
