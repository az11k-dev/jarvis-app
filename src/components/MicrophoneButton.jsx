import React from 'react';
import { TouchableOpacity, Image, Text, Animated } from 'react-native';
import { styles } from '../styles/mainStyles';

export default function MicrophoneButton({ onPress, isRecording, animatedScale }) {
    return (
        <TouchableOpacity style={styles.secondCon} onPress={onPress}>
            <Animated.View style={[styles.microAnimationContainer, { transform: [{ scale: animatedScale }] }]}>
                <Image
                    style={styles.micro}
                    source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3682/3682340.png' }}
                />
            </Animated.View>
            <Text style={styles.title}>{isRecording ? 'Recording...' : 'Tap to ask JARVIS!'}</Text>
        </TouchableOpacity>
    );
}