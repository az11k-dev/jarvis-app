import React from 'react';
import { Modal, View, Text, TouchableOpacity, FlatList } from 'react-native';
import * as Speech from 'expo-speech';
import { styles } from '../styles/mainStyles';

export default function VoicePickerModal({
                                             isVisible,
                                             availableVoices,
                                             selectedVoiceId,
                                             setSelectedVoiceId,
                                             onClose,
                                         }) {
    const handleVoiceSelect = (voice) => {
        setSelectedVoiceId(voice.identifier);
        onClose();

        Speech.speak(`Привет, я ${voice.name || 'этот голос'}.`, {
            language: voice.language,
            voice: voice.identifier,
            rate: 1,
            pitch: 1.2,
        });
    };

    const renderItem = ({ item }) => (
        <TouchableOpacity
            style={[
                styles.voiceItem,
                item.identifier === selectedVoiceId && styles.selectedVoiceItem,
            ]}
            onPress={() => handleVoiceSelect(item)}
        >
            <Text style={styles.voiceText}>
                {item.name} ({item.language} - {item.quality})
            </Text>
        </TouchableOpacity>
    );

    return (
        <Modal animationType="slide" transparent={true} visible={isVisible} onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>Выберите голос JARVIS</Text>
                    {availableVoices.length > 0 ? (
                        <FlatList
                            data={availableVoices}
                            keyExtractor={(item) => item.identifier}
                            renderItem={renderItem}
                            style={styles.voiceList}
                        />
                    ) : (
                        <Text style={styles.noVoicesText}>
                            Русские голоса не найдены на этом устройстве.
                        </Text>
                    )}
                    <TouchableOpacity style={styles.closeModalButton} onPress={onClose}>
                        <Text style={styles.closeModalButtonText}>Закрыть</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}