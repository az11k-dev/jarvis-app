import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ArcReactor, { STATUS_COLORS } from '../components/ArcReactor';
import HudBackground from '../components/hud/HudBackground';
import HudDock from '../components/hud/HudDock';
import TelegramModal, { useTelegramState } from '../components/TelegramModal';
import Transcript from '../components/Transcript';
import VisionScanner from '../components/VisionScanner';
import VoicePickerModal from '../components/VoicePickerModal';
import { useJarvis } from '../hooks/useJarvis';
import { startTelegram } from '../services/telegram';
import { COLORS, FONTS, styles } from '../styles/mainStyles';

const STATUS_TEXT = {
  off: ['Microphone off', 'Tap the core to talk'],
  standby: ['Standby', 'Say “Jarvis” or tap the core'],
  listening: ['Listening, sir', 'Go ahead — I’ll know when you’re done'],
  thinking: ['Processing', 'Tap to cancel'],
  speaking: ['Responding', 'Tap to interrupt'],
};

const modelName = (id) => {
  if (id === 'stt') return 'speech recognition';
  if (id.startsWith('piper-en-')) return 'English voice';
  return 'Russian voice';
};

function downloadLine(speech) {
  if (!speech?.downloading) return null;
  const name = modelName(speech.downloading);
  return `Downloading ${name}… ${Math.round(speech.progress * 100)}%`;
}

// Android checks the wake word on the device, so voice wake-up waits for
// the recognizer model; iOS checks it in the cloud transcript instead.
const voiceWakeReady = (speech) => !speech?.supported || speech.sttReady;

const pad = (n) => String(n).padStart(2, '0');

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(id);
  }, []);
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export default function Home() {
  const jarvis = useJarvis();
  const { engine, status, settings } = jarvis;
  const telegram = useTelegramState();
  const clock = useClock();
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
  const [isTelegramVisible, setIsTelegramVisible] = useState(false);

  // Restores the saved Telegram session (no-op when not configured).
  useEffect(() => {
    startTelegram();
  }, []);

  const color = STATUS_COLORS[status];
  const [title, defaultSubtitle] = STATUS_TEXT[status] || STATUS_TEXT.standby;
  const subtitle =
    status === 'standby' && !voiceWakeReady(jarvis.speech)
      ? 'Tap the core — “Jarvis” will work once the model downloads'
      : defaultSubtitle;
  const shownTitle =
    (status === 'standby' || status === 'listening') && jarvis.userSpeaking
      ? 'Hearing you…'
      : status === 'thinking' && jarvis.activity
        ? jarvis.activity
        : title;

  const readouts = [
    {
      key: 'MIC',
      value: settings.micEnabled ? 'ON' : 'OFF',
      ok: settings.micEnabled,
    },
    {
      key: 'STT',
      value: jarvis.speech?.sttReady ? 'LOCAL' : 'CLOUD',
      ok: true,
    },
    {
      key: 'TG',
      value: telegram.step === 'ready' ? 'LINK' : 'NONE',
      ok: telegram.step === 'ready',
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <HudBackground />

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>J.A.R.V.I.S.</Text>
          <Text style={styles.brandSub}>
            JUST A RATHER VERY INTELLIGENT SYSTEM
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.clock}>{clock}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: color }]} />
            <Text style={[styles.statusRowText, { color }]}>
              {status === 'off' ? 'OFFLINE' : 'ONLINE'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.reactorArea}>
        <View style={local.reactorRow}>
          <LevelMeter level={jarvis.level} color={color} />
          <ArcReactor
            status={status}
            level={jarvis.level}
            userSpeaking={jarvis.userSpeaking}
            onPress={() => engine.tap()}
          />
          <Readouts items={readouts} />
        </View>

        <View style={styles.statusTitleRow}>
          <View style={[styles.statusRule, { backgroundColor: color }]} />
          <Text
            style={[styles.statusTitle, { color }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {shownTitle}
          </Text>
          <View style={[styles.statusRule, { backgroundColor: color }]} />
        </View>
        <Text style={styles.statusSubtitle}>{subtitle}</Text>
        {downloadLine(jarvis.speech) && (
          <Text style={styles.downloadText}>{downloadLine(jarvis.speech)}</Text>
        )}
        {jarvis.error && <Text style={styles.errorText}>{jarvis.error}</Text>}
      </View>

      <Transcript messages={jarvis.messages} />

      <HudDock
        items={[
          {
            key: 'mic',
            icon: settings.micEnabled ? 'mic' : 'micOff',
            label: settings.micEnabled ? 'MIC' : 'OFF',
            tone: settings.micEnabled ? 'active' : 'alert',
            onPress: () => engine.setMicEnabled(!settings.micEnabled),
          },
          {
            key: 'voice',
            icon: 'voice',
            label: 'VOICE',
            onPress: () => setIsVoicePickerVisible(true),
          },
          {
            key: 'telegram',
            icon: 'send',
            label: 'TELEGRAM',
            badge: telegram.step === 'ready' ? COLORS.cyan : undefined,
            onPress: () => setIsTelegramVisible(true),
          },
          {
            key: 'reset',
            icon: 'reset',
            label: 'RESET',
            onPress: () => engine.clearConversation(),
          },
        ]}
      />

      <VoicePickerModal
        isVisible={isVoicePickerVisible}
        deviceVoices={jarvis.deviceVoices}
        installedModels={jarvis.speech.installed}
        selected={settings.voice}
        onSelect={(voice, lang) => engine.setVoice(voice, lang)}
        onClose={() => setIsVoicePickerVisible(false)}
      />
      <TelegramModal
        isVisible={isTelegramVisible}
        onClose={() => setIsTelegramVisible(false)}
      />
      <VisionScanner />
    </SafeAreaView>
  );
}

const SEGMENTS = 14;

/** Vertical microphone level bar, bottom-up; driven natively by `level`. */
function LevelMeter({ level, color }) {
  return (
    <View style={local.side}>
      <Text style={local.sideLabel}>VOX</Text>
      <View style={local.meter}>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const at = ((SEGMENTS - i) / SEGMENTS) * 0.7;
          return (
            <Animated.View
              key={i}
              style={[
                local.segment,
                {
                  backgroundColor: color,
                  opacity: level.interpolate({
                    inputRange: [at - 0.05, at],
                    outputRange: [0.12, 1],
                    extrapolate: 'clamp',
                  }),
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

function Readouts({ items }) {
  return (
    <View style={[local.side, local.sideRight]}>
      {items.map((r) => (
        <View key={r.key} style={local.readout}>
          <Text style={local.sideLabel}>{r.key}</Text>
          <Text
            style={[
              local.readoutValue,
              { color: r.ok ? COLORS.cyan : COLORS.muted },
            ]}
          >
            {r.value}
          </Text>
          <View
            style={[
              local.readoutBar,
              { backgroundColor: r.ok ? COLORS.cyan : COLORS.line },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  reactorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: { width: 46, alignItems: 'flex-start' },
  sideRight: { alignItems: 'flex-end' },
  sideLabel: {
    color: COLORS.muted,
    fontFamily: FONTS.readout,
    fontSize: 7.5,
    letterSpacing: 2,
  },
  meter: { marginTop: 6 },
  segment: { width: 12, height: 3, marginBottom: 3 },
  readout: { alignItems: 'flex-end', marginVertical: 8 },
  readoutValue: {
    marginTop: 3,
    fontFamily: FONTS.readout,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  readoutBar: { marginTop: 4, width: 22, height: 1.5 },
});
