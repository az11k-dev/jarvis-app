import React, {useEffect, useState} from 'react';
import { SafeAreaView, StyleSheet, Text, View, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import Voice from '@react-native-voice/voice';
import * as Speech from 'expo-speech';
import axios from 'axios';
import { Audio } from 'expo-av';

const OPENAI_API_KEY = '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'; // Вставь сюда свой ключ!

export default function Home() {
    const [recording, setRecording] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const [botReply, setBotReply] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        Voice.onSpeechResults = onSpeechResults;

        return () => {
            Voice.destroy().then(Voice.removeAllListeners);
        };
    }, []);

    const askMicrophonePermission = async () => {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
            alert('Microphone permission is required!');
            return false;
        }
        return true;
    };

    // Когда получили текст с микрофона:
    const onSpeechResults = async (event) => {
        const text = event?.value?.[0];
        if (!text) {
            alert("Didn't catch that. Try again.");
            setRecording(false);
            return;
        }
        setRecognizedText(text);
        await Voice.stop();
        await Voice.destroy();
        sendToOpenAI(text);
        setRecording(false);
    };



    // START/STOP слушать микрофон
    const startListening = async () => {
        const granted = await askMicrophonePermission();
        if (!granted) return;

        setRecognizedText('');
        setBotReply('');
        setRecording(true);
        Voice.onSpeechResults = onSpeechResults;

        try {
            await Voice.start('en-US'); // or 'ru-RU'
        } catch (e) {
            setRecording(false);
            alert('Microphone error');
            console.error(e);
        }
    };



    // Открываем OpenAI для ответа
    const sendToOpenAI = async (prompt) => {
        setLoading(true);
        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 100,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    },
                }
            );
            const answer = response.data.choices[0].message.content;
            setBotReply(answer);
            // Озвучим ответ
            Speech.speak(answer, { language: 'en' }); // или ru
        } catch (err) {
            setBotReply('Ошибка запроса к OpenAI!');
        }
        setLoading(false);
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.thirdCon}>
                <Text style={styles.resp}>
                    {recognizedText ? `Вы спросили: "${recognizedText}"` : 'Нажми на микрофон и задай вопрос голосом!'}
                </Text>
                <Text style={styles.resp}>
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.resp}>{botReply}</Text>
                    )}
                </Text>
            </View>
            <TouchableOpacity style={styles.secondCon} onPress={startListening} disabled={recording || loading}>
                <Text style={styles.title}>{recording ? "Listening..." : "Tap to ask JARVIS!"}</Text>
                <Image style={styles.micro} source={{uri:'https://cdn-icons-png.flaticon.com/512/3682/3682340.png'}} />
            </TouchableOpacity>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#111827',
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondCon: {
        borderWidth: 1,
        borderColor: 'blue',
        padding: 75,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: 'center',
    },
    title: {
        fontSize: 22,
        color: 'white',
        marginBottom: 50,
    },
    micro: {
        width: 100,
        height: 100,
    },
    thirdCon: {
        width: 350,
        height: 200,
        backgroundColor: '#374151',
        borderRadius: 20,
        marginBottom: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    resp: {
        color: 'white',
        fontSize: 18,
        marginVertical: 5,
        textAlign: 'center'
    }
});