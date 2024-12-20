const { TwitterApi } = require('twitter-api-v2');
const { Configuration, OpenAIApi } = require('openai');
const cron = require('node-cron');
const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');
require('dotenv').config();

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const openaiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(openaiConfig);

async function generateTweet(prompt) {
  const result = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt,
    max_tokens: 100,
  });
  return result.data.choices[0].text.trim();
}

async function generateImage(prompt) {
  const result = await openai.createImage({
    prompt,
    n: 1,
    size: '1024x1024',
  });
  return result.data.data[0].url;
}

async function createImageWithText(text) {
  const canvas = createCanvas(1024, 512);
  const ctx = canvas.getContext('2d');

  // Set background
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 1024, 512);

  // Add text
  ctx.font = '32px Arial';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(text, 512, 256);

  return canvas.toBuffer();
}

async function postTweet(text, imageUrl = null) {
  try {
    let mediaId;
    if (imageUrl) {
      const imageBuffer = await axios.get(imageUrl, { responseType: 'arraybuffer' }).then(response => Buffer.from(response.data));
      mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });
    }

    const tweet = await twitterClient.v2.tweet({
      text: text,
      media: mediaId ? { media_ids: [mediaId] } : undefined,
    });

    console.log('Tweet posted:', tweet.data.id);
    return tweet.data.id;
  } catch (error) {
    console.error('Error posting tweet:', error);
  }
}

async function postPoll() {
  const pollQuestion = await generateTweet("Generate a poll question about technology trends");
  const pollOptions = await generateTweet("Generate 4 short options for the poll: " + pollQuestion);

  const options = pollOptions.split('\n').filter(option => option.trim() !== '').slice(0, 4);

  try {
    const poll = await twitterClient.v2.tweet({
      text: pollQuestion,
      poll: { duration_minutes: 1440, options },
    });

    console.log('Poll posted:', poll.data.id);
    return poll.data.id;
  } catch (error) {
    console.error('Error posting poll:', error);
  }
}

async function replyToComments(tweetId) {
  try {
    const replies = await twitterClient.v2.search(`conversation_id:${tweetId}`);
    
    for (const reply of replies.data.data) {
      if (reply.id !== tweetId) {
        const replyText = await generateTweet(`Generate a friendly and engaging reply to this tweet: "${reply.text}"`);
        await twitterClient.v2.reply(replyText, reply.id);
        console.log('Replied to comment:', reply.id);
      }
    }
  } catch (error) {
    console.error('Error replying to comments:', error);
  }
}

// Schedule tweets
cron.schedule('0 */3 * * *', async () => {
  const tweetText = await generateTweet("Generate an engaging tweet about technology with relevant hashtags");
  const imagePrompt = await generateTweet("Generate a prompt for an image related to this tweet: " + tweetText);
  const imageUrl = await generateImage(imagePrompt);
  await postTweet(tweetText, imageUrl);
});

// Schedule weekly poll
cron.schedule('0 12 * * 1', async () => {
  await postPoll();
});

// Schedule reply to comments (every 6 hours)
cron.schedule('0 */6 * * *', async () => {
  const recentTweets = await twitterClient.v2.userTimeline(process.env.TWITTER_USER_ID, { max_results: 5 });
  for (const tweet of recentTweets.data.data) {
    await replyToComments(tweet.id);
  }
});

module.exports = async (req, res) => {
  res.status(200).json({ message: 'Twitter bot is running' });
};

