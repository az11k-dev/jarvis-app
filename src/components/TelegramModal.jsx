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
    'Код отправлен в Telegram на другом устройстве.',
  authenticationCodeTypeSms: 'Код отправлен по SMS.',
  authenticationCodeTypeCall: 'Код продиктуют в звонке.',
  authenticationCodeTypeFlashCall: 'Вам позвонят — код в номере звонящего.',
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
            <Text style={styles.closeModalButtonText}>Закрыть</Text>
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
          Telegram не настроен. Добавьте EXPO_PUBLIC_TG_API_ID и
          EXPO_PUBLIC_TG_API_HASH в .env (my.telegram.org) и пересоберите
          приложение. Работает только на Android.
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
            Вы вошли как {Telegram.displayName(state.me) || '…'}
          </Text>
          <TgButton
            label="Выйти из Telegram"
            busy={state.busy}
            onPress={Telegram.logOut}
          />
        </>
      );
    case 'phone':
      return (
        <Step
          key="phone"
          hint="Войдите в свой аккаунт. JARVIS будет читать и отправлять сообщения от вашего имени."
          placeholder="+998 90 123 45 67"
          keyboardType="phone-pad"
          autoComplete="tel"
          label="Получить код"
          busy={state.busy}
          onSubmit={Telegram.submitPhone}
        />
      );
    case 'code':
      return (
        <>
          <Step
            key="code"
            hint={CODE_SOURCE[state.codeType] || 'Введите код подтверждения.'}
            placeholder="Код"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            label="Войти"
            busy={state.busy}
            onSubmit={Telegram.submitCode}
          />
          <TouchableOpacity onPress={Telegram.resendCode} disabled={state.busy}>
            <Text style={styles.tgLink}>Отправить код ещё раз</Text>
          </TouchableOpacity>
        </>
      );
    case 'password':
      return (
        <Step
          key="password"
          hint={
            state.passwordHint
              ? `Облачный пароль (подсказка: ${state.passwordHint})`
              : 'Облачный пароль (двухэтапная проверка)'
          }
          placeholder="Пароль"
          secureTextEntry
          label="Войти"
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
