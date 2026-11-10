import React from 'react';
import { Modal, SectionList, Text, TouchableOpacity, View } from 'react-native';
import {
  DEFAULT_VOICE,
  ENGLISH_VOICES,
  RUSSIAN_VOICES,
  SPEECH_MODELS,
} from '../config/jarvis';
import HudCorners from './hud/HudCorners';
import { styles } from '../styles/mainStyles';

export default function VoicePickerModal({
  isVisible,
  deviceVoices,
  installedModels,
  selected,
  onSelect,
  onClose,
}) {
  // Picking a Russian voice keeps the English one and vice versa.
  const local = selected?.engine === 'local' ? selected : DEFAULT_VOICE;
  const sizeNote = (modelId) =>
    installedModels.includes(modelId)
      ? ''
      : ` · download ${SPEECH_MODELS[modelId].sizeMb} MB`;

  const sections = [
    {
      title: 'Russian voice (on device)',
      data: RUSSIAN_VOICES.map((v) => ({
        key: `ru:${v.id}`,
        label: v.label + sizeNote(`piper-${v.id}`),
        selected: selected?.engine === 'local' && selected.ru === v.id,
        voice: { ...local, engine: 'local', ru: v.id },
        lang: 'ru',
      })),
    },
    {
      title: 'English voice (on device)',
      data: ENGLISH_VOICES.map((v) => ({
        key: `en:${v.id}`,
        label: v.label + sizeNote(`piper-${v.id}`),
        selected: selected?.engine === 'local' && selected.en === v.id,
        voice: { ...local, engine: 'local', en: v.id },
        lang: 'en',
      })),
    },
    {
      title: 'Device voices (system TTS)',
      data: deviceVoices.map((v) => ({
        key: `device:${v.identifier}`,
        label: `${v.name} · ${v.language}${v.quality === 'Enhanced' ? ' · HD' : ''}`,
        selected: selected?.engine === 'device' && selected.id === v.identifier,
        voice: { engine: 'device', id: v.identifier, language: v.language },
      })),
    },
  ];

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
          <Text style={styles.modalTitle}>JARVIS voice</Text>
          <View style={styles.modalTitleRule} />
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.key}
            style={styles.voiceList}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.voiceItem,
                  item.selected && styles.selectedVoiceItem,
                ]}
                onPress={() => onSelect(item.voice, item.lang)}
              >
                <Text
                  style={[
                    styles.voiceText,
                    item.selected && styles.selectedVoiceText,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={styles.closeModalButton} onPress={onClose}>
            <Text style={styles.closeModalButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
