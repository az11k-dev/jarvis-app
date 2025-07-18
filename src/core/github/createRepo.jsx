export async function createGitHubRepo(options) {
    const token = process.env.EXPO_PUBLIC_GITHUB_TOKEN_KEY;

    if (!token) {
        throw new Error('GitHub token not found.');
    }

    const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: options.name,
            description: options.description || '',
            private: options.private ?? false,
            auto_init: options.autoInit ?? true,
        }),
    });

    const text = await res.text(); // читаем один раз
    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`Invalid JSON returned: ${text}`);
    }

    if (!res.ok) {
        console.error('GitHub Error Response:', data);
        throw new Error(`Failed to create repo: ${data?.message || 'Unknown error'}`);
    }

    return data.html_url;
}