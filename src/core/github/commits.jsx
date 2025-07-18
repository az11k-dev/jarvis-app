const BASE_URL = 'https://api.github.com';
const OWNER = 'az11k-dev'; // Например: 'azizbek-dev'
const REPO = 'jarvis-app';        // Например: 'jarvis-app'

export async function getLatestCommits(limit = 5) {
    const token = process.env.EXPO_PUBLIC_GITHUB_TOKEN_KEY;

    if (!token) {
        throw new Error('GitHub token not found. Please login first.');
    }

    const res = await fetch(`${BASE_URL}/repos/${OWNER}/${REPO}/commits?per_page=${limit}`, {
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
        },
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch commits: ${res.status} - ${errorText}`);
    }

    const data = await res.json();

    return data.map((item) => ({
        author: item.commit.author.name,
        message: item.commit.message,
        date: item.commit.author.date,
        url: item.html_url,
    }));
}