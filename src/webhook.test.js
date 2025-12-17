import request from 'supertest';
import app from '../src/index.js';
import { supabase } from '../src/supabaseClient.js';
import handleNewUser from './newUserHandler.js';
import handleTextMessage from './textHandler.js';
import handleInteractiveMessage from './interactiveHandler.js';

// Mock dependencies to isolate our tests
jest.mock('../src/supabaseClient.js', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    upsert: jest.fn(),
  },
}));

// Mock the handlers so we can verify they are called correctly
jest.mock('./newUserHandler.js');
jest.mock('./textHandler.js', () => jest.fn());
jest.mock('./interactiveHandler.js', () => jest.fn());

describe('Chatbot Webhook', () => {
  beforeEach(() => {
    // Clear all mocks before each test to ensure a clean state
    jest.clearAllMocks();
    // Reset mock implementations to avoid side-effects between tests
  });

  it('GET / should return a 200 status and a running message', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe('WhatsApp chatbot webhook running');
  });

  // Test 2: Meta Webhook Verification
  it('GET /webhook should verify the token and return the challenge', async () => {
    const VERIFY_TOKEN = 'MY_CHATBOT_SECRET_TOKEN_12032025';
    process.env.META_VERIFY_TOKEN = VERIFY_TOKEN;
    const CHALLENGE = '1158201444';

    const res = await request(app)
      .get('/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': CHALLENGE,
      });

    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe(CHALLENGE);
  });

  it('GET /webhook should reject invalid verification requests', async () => {
    const res = await request(app)
      .get('/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'invalid_token',
        'hub.challenge': '12345',
      });

    expect(res.statusCode).toEqual(403);
  });

  // Test 3: New User Onboarding Flow
  describe('POST /webhook for a new user', () => {
    it('should trigger the new user handler when the phone number is not found', async () => {
      // Simulate Supabase returning no user
      supabase.from('users').select('*').eq('phone', '1234567890').maybeSingle.mockResolvedValue({ data: null, error: null });
      // Simulate Supabase returning no session
      supabase.from('sessions').select('session_data').eq('phone', '1234567890').maybeSingle.mockResolvedValue({ data: null, error: null });

      const mockMessage = {
        object: 'whatsapp_business_account',
        entry: [{
          changes: [{
            value: {
              messages: [{
                from: '1234567890',
                text: { body: 'Hello' },
              }],
            },
          }],
        }],
      };

      const res = await request(app).post('/webhook').send(mockMessage);

      expect(res.statusCode).toEqual(200);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(handleNewUser).toHaveBeenCalledTimes(1);
      expect(handleNewUser).toHaveBeenCalledWith(expect.any(Object), 'Hello');
    });
  });

  // Test 4: Existing User Flow
  describe('POST /webhook for an existing user', () => {
    it('should trigger the text message handler for an existing user', async () => {
      const mockUser = { id: 'user-uuid', full_name: 'John Doe', phone: '1234567890' };
      // Simulate Supabase finding a user
      supabase.from('users').select('*').eq('phone', '1234567890').maybeSingle.mockResolvedValue({ data: mockUser, error: null });
      // Simulate Supabase finding a session
      supabase.from('sessions').select('session_data').eq('phone', '1234567890').maybeSingle.mockResolvedValue({ data: { session_data: { stage: 'start' } }, error: null });

      const mockMessage = {
        object: 'whatsapp_business_account',
        entry: [{
          changes: [{
            value: {
              messages: [{
                from: '1234567890',
                text: { body: 'Buy an item' },
              }],
            },
          }],
        }],
      };

      const res = await request(app).post('/webhook').send(mockMessage);

      expect(res.statusCode).toEqual(200);
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(handleTextMessage).toHaveBeenCalledTimes(1);
      expect(handleTextMessage).toHaveBeenCalledWith('Buy an item', expect.objectContaining({
        name: 'John Doe',
        userData: mockUser,
      }));
    });
  });
});