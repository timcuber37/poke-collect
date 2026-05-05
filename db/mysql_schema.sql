-- Poke-Collect - MySQL Write Side Schema

CREATE DATABASE IF NOT EXISTS pokemon_tcg;
USE pokemon_tcg;

CREATE TABLE users (
    user_id   CHAR(36)     NOT NULL DEFAULT (UUID()),
    username  VARCHAR(50)  NOT NULL UNIQUE,
    email     VARCHAR(100) NOT NULL UNIQUE,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    INDEX idx_username (username)
);

-- Master catalog of all Pokemon cards
-- card_id is VARCHAR(255) to accommodate PokéWallet IDs (e.g. pk_<hex>)
CREATE TABLE cards (
    card_id       VARCHAR(255) NOT NULL,
    name          VARCHAR(100) NOT NULL,
    set_name      VARCHAR(100) NOT NULL,
    rarity        VARCHAR(50)  NOT NULL,
    card_type     VARCHAR(50)  NOT NULL,
    description   TEXT,
    image_url     VARCHAR(255),
    pokewallet_id VARCHAR(255) NULL UNIQUE,
    PRIMARY KEY (card_id),
    INDEX idx_set (set_name),
    INDEX idx_rarity (rarity)
);

-- User collections (owns a specific card)
CREATE TABLE collections (
    collection_id CHAR(36)     NOT NULL DEFAULT (UUID()),
    user_id       CHAR(36)     NOT NULL,
    card_id       VARCHAR(255) NOT NULL,
    `condition`   ENUM('Mint', 'Near Mint', 'Excellent', 'Good', 'Poor') NOT NULL DEFAULT 'Near Mint',
    acquired_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (card_id) REFERENCES cards(card_id),
    INDEX idx_user_collection (user_id)
);

-- Seed: sample users
INSERT INTO users (user_id, username, email) VALUES
    ('user-001', 'ash_ketchum', 'ash@pokemon.com'),
    ('user-002', 'misty_w',     'misty@pokemon.com'),
    ('user-003', 'brock_s',     'brock@pokemon.com');

-- Seed: sample card catalog
INSERT INTO cards (card_id, name, set_name, rarity, card_type, description) VALUES
    ('card-001', 'Charizard',      'Base Set',          'Holo Rare',   'Fire',     'A flame Pokemon whose wings can carry it close to an altitude of 4,600 feet.'),
    ('card-002', 'Blastoise',      'Base Set',          'Holo Rare',   'Water',    'A brutal Pokemon with pressurized water cannons on its shell.'),
    ('card-003', 'Venusaur',       'Base Set',          'Holo Rare',   'Grass',    'There is a large flower on Venusaur''s back that has bloomed.'),
    ('card-004', 'Pikachu',        'Base Set',          'Common',      'Electric', 'When Pikachu meet, they''ll touch their tails together and zap each other.'),
    ('card-005', 'Mewtwo',         'Base Set',          'Holo Rare',   'Psychic',  'A Pokemon created by recombining Mew''s genes. It''s said to have the most savage heart.'),
    ('card-006', 'Gyarados',       'Base Set',          'Holo Rare',   'Water',    'Once it begins to rampage, it will not stop until everything is destroyed.'),
    ('card-007', 'Alakazam',       'Base Set',          'Holo Rare',   'Psychic',  'Its brain can outperform a supercomputer. Its IQ of 5000 is the highest of all Pokemon.'),
    ('card-008', 'Gengar',         'Fossil',            'Holo Rare',   'Psychic',  'Under a full moon, this Pokemon likes to mimic the shadows of people.'),
    ('card-009', 'Lugia',          'Neo Genesis',       'Holo Rare',   'Psychic',  'It is said that a LUGIA that has been seen will cause a 40-day storm.'),
    ('card-010', 'Ho-Oh',          'Neo Revelation',    'Holo Rare',   'Fire',     'A Pokemon that is said to live at the foot of a rainbow.'),
    ('card-011', 'Umbreon',        'Neo Discovery',     'Holo Rare',   'Dark',     'When darkness falls, the rings on its body begin to shimmer.'),
    ('card-012', 'Espeon',         'Neo Discovery',     'Holo Rare',   'Psychic',  'By day, it uses the orb on its head to predict the weather.'),
    ('card-013', 'Rayquaza',       'EX Deoxys',         'Holo Rare EX','Dragon',   'It lives in the ozone layer far above the clouds and cannot be seen from the ground.'),
    ('card-014', 'Charizard VMAX', 'Darkness Ablaze',   'Ultra Rare',  'Fire',     'This colossal, flame-winged figure of a Charizard was brought to life by Gigantamax Factor.'),
    ('card-015', 'Pikachu VMAX',   'Vivid Voltage',     'Ultra Rare',  'Electric', 'When it transforms into Gigantamax Pikachu, its tail becomes like a lightning bolt.');

-- Seed: assign some cards to users
INSERT INTO collections (collection_id, user_id, card_id, `condition`) VALUES
    ('col-001', 'user-001', 'card-001', 'Near Mint'),
    ('col-002', 'user-001', 'card-004', 'Mint'),
    ('col-003', 'user-001', 'card-005', 'Excellent'),
    ('col-004', 'user-002', 'card-002', 'Near Mint'),
    ('col-005', 'user-002', 'card-006', 'Good'),
    ('col-006', 'user-003', 'card-008', 'Near Mint'),
    ('col-007', 'user-003', 'card-009', 'Mint');
