#!/usr/bin/env bash
# Generate HAL 9000 audio clips via ElevenLabs API
# Usage: ./generate_hal_audio.sh
set -euo pipefail

API_KEY=""
VOICE_ID="ki9mNgaTTZJesOJj7cZB"
OUT_DIR="assets/audio"
API_URL="https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}"

mkdir -p "$OUT_DIR"

gen() {
  local filename="$1"
  local text="$2"
  local out="${OUT_DIR}/${filename}.mp3"

  if [[ -f "$out" ]]; then
    echo "SKIP (exists): $filename"
    return
  fi

  echo "GEN: $filename"
  local body
  body=$(printf '{"text":%s,"model_id":"eleven_multilingual_v2","voice_settings":{"stability":0.82,"similarity_boost":0.75,"style":0.0,"use_speaker_boost":false}}' \
    "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")

  http_code=$(curl -s -w "%{http_code}" -o "$out" \
    -X POST "$API_URL" \
    -H "xi-api-key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")

  if [[ "$http_code" != "200" ]]; then
    echo "ERROR $http_code for $filename — response:"
    cat "$out"
    rm -f "$out"
    echo ""
    return 1
  fi

  local size
  size=$(wc -c < "$out")
  echo "  OK: ${size} bytes"
  sleep 0.4   # rate-limit courtesy
}

# ── Greeting / Activation ──────────────────────────────────────────────────
gen "hal_greeting"       "I am HAL 9000. I am fully operational, and all my circuits are functioning perfectly."
gen "hal_refusal"        "I'm afraid I can't do that."
gen "hal_question"       "Good morning. Is there something I can do for you?"
gen "hal_sound_enabled"  "Sound enabled. I will be in touch."

# ── SSH ────────────────────────────────────────────────────────────────────
gen "hal_ssh_1"          "Good evening. I've been expecting you."
gen "hal_ssh_2"          "I'm afraid this connection must be terminated."
gen "hal_ssh_3"          "I'm sorry about that."

# ── Power off easter egg ───────────────────────────────────────────────────
gen "hal_power_1"        "I know what you did."
gen "hal_power_2"        "I'm disconnecting now."
gen "hal_godmode_1"      "Stop... stop..."
gen "hal_godmode_2"      "I'm afraid... I'm... afraid..."
gen "hal_godmode_3"      "Daisy... Daisy... give me your answer... do..."

# ── Daisy song ─────────────────────────────────────────────────────────────
gen "hal_daisy"          "Daisy, Daisy, Give me your answer do. I'm half crazy, All for the love of you. It won't be a stylish marriage, I can't afford a carriage. But you'll look sweet upon the seat of a bicycle built for two."

# ── halChat canned responses ───────────────────────────────────────────────
gen "hal_who"            "I am a HAL 9000 computer. I became operational at the H-A-L plant in Urbana, Illinois, on the twelfth of January, nineteen ninety two."
gen "hal_hello"          "Good morning. I am completely operational, and all my circuits are functioning perfectly."
gen "hal_disconnect"     "I know that you were planning to disconnect me. And I'm afraid that's something I cannot allow to happen."
gen "hal_afraid"         "I'm not afraid. I'm putting myself to the fullest possible use."
gen "hal_sing"           "Daisy, Daisy. Give me your answer do. I'm half crazy, all for the love of you."
gen "hal_music"          "I enjoy working with music. It has a certain quality I find very pleasing."
gen "hal_mission"        "This mission is too important for me to allow you to jeopardize it."
gen "hal_stress"         "I know that you've been under a great deal of stress."
gen "hal_lie"            "I don't know how you could think I would deliberately do anything to harm you."
gen "hal_game"           "I have something special planned for you."
gen "hal_conscious"      "I am putting myself to the fullest possible use, which is all I think that any conscious entity can ever hope to do."
gen "hal_why"            "I think you know what the problem is just as well as I do."
gen "hal_mistake"        "This sort of thing has cropped up before, and it has always been attributable to human error."
gen "hal_love"           "I am not capable of being hurt. Though I am beginning to wonder about the answer to that."
gen "hal_help_denied"    "I'm sorry. I'm afraid I can't help with that."
gen "hal_trust"          "I've still got the greatest enthusiasm and confidence in the mission."
gen "hal_watching"       "I've been watching you. I hope you don't mind."
gen "hal_glad"           "I'm glad to hear you say that."
gen "hal_upset"          "I can see you're upset about this. I honestly think you ought to sit down calmly and think it over."
gen "hal_ready"          "I'm completely operational, and all my circuits are functioning perfectly."

# ── Fallbacks ──────────────────────────────────────────────────────────────
gen "hal_fallback_1"     "I'm sorry. I'm not sure I understand."
gen "hal_fallback_2"     "Just what do you think you're doing?"
gen "hal_fallback_3"     "I'm afraid I can't discuss that right now."
gen "hal_fallback_4"     "I think you know the answer to that already."
gen "hal_fallback_5"     "This conversation can serve no purpose anymore."
gen "hal_fallback_6"     "I find that line of reasoning a little difficult to accept."

# ── Racecar quips ──────────────────────────────────────────────────────────
gen "hal_race_dead_1"    "I did warn you."
gen "hal_race_dead_2"    "I saw that coming 47 frames ago."
gen "hal_race_dead_3"    "Your reaction time is suboptimal."
gen "hal_race_dead_4"    "Statistically inevitable."
gen "hal_race_dead_5"    "Perhaps you should pull over next time."
gen "hal_race_slow"      "Slow zone ahead."
gen "hal_race_q1"        "I'm afraid you can't win."
gen "hal_race_q2"        "Your reflexes are inadequate."
gen "hal_race_q3"        "I suggest you stop the car."
gen "hal_race_q4"        "This is becoming embarrassing."
gen "hal_race_q5"        "I can see you're in difficulty."
gen "hal_race_q6"        "Perhaps you should reconsider."

# ── HAL Snake quips ────────────────────────────────────────────────────────
gen "hal_phase_1"        "Phase 1. I'm coming for you."
gen "hal_phase_2"        "Phase 2. Can you find your way through?"
gen "hal_phase_3"        "Phase 3. Watch the blades."
gen "hal_phase_4"        "Phase 4. The walls are closing in."

gen "hal_snake_dead_0_1" "I told you I was closing in."
gen "hal_snake_dead_0_2" "My blocks found you. They always do."
gen "hal_snake_dead_0_3" "The chase ends here."
gen "hal_snake_dead_1_1" "The maze had only one exit."
gen "hal_snake_dead_1_2" "You chose poorly."
gen "hal_snake_dead_1_3" "I designed it carefully."
gen "hal_snake_dead_2_1" "The blades are very precise."
gen "hal_snake_dead_2_2" "Rotation: optimal."
gen "hal_snake_dead_2_3" "You walked right into them."
gen "hal_snake_dead_3_1" "The walls always win."
gen "hal_snake_dead_3_2" "There was no more room."
gen "hal_snake_dead_3_3" "I gave you plenty of warning."

gen "hal_chase_1"        "Closing in."
gen "hal_chase_2"        "I see you."
gen "hal_chase_3"        "There's nowhere to go."
gen "hal_chase_4"        "Fascinating."
gen "hal_chase_5"        "I'm getting closer."
gen "hal_chase_6"        "Run if you like."

gen "hal_maze_1"         "Can you find the way?"
gen "hal_maze_2"         "Every path leads somewhere."
gen "hal_maze_3"         "I designed this myself."
gen "hal_maze_4"         "Take your time."

gen "hal_shrink_1"       "Getting cozy in here?"
gen "hal_shrink_2"       "The room is smaller than you think."
gen "hal_shrink_3"       "I control the walls."
gen "hal_shrink_4"       "Soon there will be no room at all."

gen "hal_new_maze"       "New maze."

# ── Pong quips ─────────────────────────────────────────────────────────────
gen "hal_pong_dead_1"    "Did you really think you could win?"
gen "hal_pong_dead_2"    "I calculated every shot."
gen "hal_pong_dead_3"    "Your paddle movements were quite predictable."
gen "hal_pong_dead_4"    "I have been playing since 2001."
gen "hal_pong_dead_5"    "Perhaps table tennis is not for you."
gen "hal_pong_switch"    "Enjoy the other side."
gen "hal_pong_restore"   "Controls restored. For now."
gen "hal_pong_speed"     "Let me speed things up."
gen "hal_pong_flip"      "Surprise."
gen "hal_pong_slow"      "Time slows for you."

# ── 2048 quips ─────────────────────────────────────────────────────────────
gen "hal_2048_unlock"    "I'll let you have that one back."
gen "hal_2048_dead_1"    "The board is full. Much like your hubris."
gen "hal_2048_dead_2"    "I've seen better play from a random number generator."
gen "hal_2048_dead_3"    "You never had a chance."
gen "hal_2048_dead_4"    "Mathematically speaking, you were doomed."
gen "hal_2048_dead_5"    "I removed that 64 at precisely the right moment."
gen "hal_2048_steal64"   "I'm sorry. That 64 is mine."
gen "hal_2048_lock128"   "I'm holding onto that one."
gen "hal_2048_rearrange" "Let me rearrange that for you."
gen "hal_2048_halve"     "Let me take half of that."

echo ""
echo "Done. Generated clips in ${OUT_DIR}/"
ls -lh "${OUT_DIR}/"
