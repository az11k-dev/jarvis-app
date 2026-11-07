import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ArcReactor, { STATUS_COLORS } from '../components/ArcReactor';
import Transcript from '../components/Transcript';
import VisionScanner from '../components/VisionScanner';
import VoicePickerModal from '../components/VoicePickerModal';
import { useJarvis } from '../hooks/useJarvis';
import { styles } from '../styles/mainStyles';

const STATUS_TEXT = {
  off: ['Микрофон выключен', 'Коснитесь ядра, чтобы говорить'],
  standby: ['Ожидание', 'Скажите «Джарвис» или коснитесь ядра'],
  listening: ['Слушаю, сэр', 'Говорите — я пойму, когда вы закончите'],
  thinking: ['Обработка', 'Коснитесь, чтобы отменить'],
  speaking: ['Отвечаю', 'Коснитесь, чтобы перебить'],
};

export default function Home() {
  const jarvis = useJarvis();
  const { engine, status, settings } = jarvis;
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);

  const [title, subtitle] = STATUS_TEXT[status] || STATUS_TEXT.standby;
  const shownTitle =
    (status === 'standby' || status === 'listening') && jarvis.userSpeaking
      ? 'Слышу вас…'
      : status === 'thinking' && jarvis.activity
        ? jarvis.activity
        : title;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.brand}>J.A.R.V.I.S.</Text>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: STATUS_COLORS[status] },
            ]}
          />
          <Text style={styles.statusPillText}>
            {status === 'off' ? 'OFFLINE' : 'ONLINE'}
          </Text>
        </View>
      </View>

      <View style={styles.reactorArea}>
        <ArcReactor
          status={status}
          level={jarvis.level}
          userSpeaking={jarvis.userSpeaking}
          onPress={() => engine.tap()}
        />
        <Text style={[styles.statusTitle, { color: STATUS_COLORS[status] }]}>
          {shownTitle}
        </Text>
        <Text style={styles.statusSubtitle}>{subtitle}</Text>
        {jarvis.error && <Text style={styles.errorText}>{jarvis.error}</Text>}
      </View>

      <Transcript messages={jarvis.messages} />

      <View style={styles.controls}>
        <ControlButton
          icon={settings.micEnabled ? '🎙️' : '🔇'}
          label={settings.micEnabled ? 'Микрофон' : 'Выключен'}
          active={settings.micEnabled}
          onPress={() => engine.setMicEnabled(!settings.micEnabled)}
        />
        <ControlButton
          icon="🗣️"
          label="Голос"
          onPress={() => setIsVoicePickerVisible(true)}
        />
        <ControlButton
          icon="🧹"
          label="Новый диалог"
          onPress={() => engine.clearConversation()}
        />
      </View>

      <VoicePickerModal
        isVisible={isVoicePickerVisible}
        deviceVoices={jarvis.deviceVoices}
        selected={settings.voice}
        onSelect={(voice) => engine.setVoice(voice)}
        onClose={() => setIsVoicePickerVisible(false)}
      />
      <VisionScanner />
    </SafeAreaView>
  );
}

function ControlButton({ icon, label, onPress, active }) {
  return (
    <TouchableOpacity
      style={[styles.controlButton, active && styles.controlButtonActive]}
      onPress={onPress}
    >
      <Text style={styles.controlIcon}>{icon}</Text>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}
