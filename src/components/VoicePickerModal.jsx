import React from 'react';
import { Modal, SectionList, Text, TouchableOpacity, View } from 'react-native';
import { OPENAI_VOICES } from '../config/jarvis';
import { styles } from '../styles/mainStyles';

export default function VoicePickerModal({
  isVisible,
  deviceVoices,
  selected,
  onSelect,
  onClose,
}) {
  const sections = [
    {
      title: 'Нейронный голос JARVIS (OpenAI)',
      data: OPENAI_VOICES.map((v) => ({
        engine: 'openai',
        id: v.id,
        label: v.label,
      })),
    },
    {
      title: 'Голоса устройства (офлайн, быстрее)',
      data: deviceVoices.map((v) => ({
        engine: 'device',
        id: v.identifier,
        language: v.language,
        label: `${v.name} · ${v.language}${v.quality === 'Enhanced' ? ' · HD' : ''}`,
      })),
    },
  ];

  const isSelected = (item) =>
    selected?.engine === item.engine && selected?.id === item.id;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Голос JARVIS</Text>
          <SectionList
            sections={sections}
            keyExtractor={(item) => `${item.engine}:${item.id}`}
            style={styles.voiceList}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.voiceItem,
                  isSelected(item) && styles.selectedVoiceItem,
                ]}
                onPress={() => onSelect(item)}
              >
                <Text style={styles.voiceText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={styles.closeModalButton} onPress={onClose}>
            <Text style={styles.closeModalButtonText}>Готово</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
