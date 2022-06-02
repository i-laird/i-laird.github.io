---
layout: post
title:  "Terminal Quality of Life Improvements"
date:   2022-05-31
categories: 
  - productivity
tags:
  - mac
  - linux
  - productivity
---

Here are some of the improvements I use to make my terminal experience better on my macbook. Most of these should also work on Linux.

# Oh My ZSH
Because I use Z shell as my default shell, I am able to use [Oh my Zsh](https://ohmyz.sh/) which is absolutely amazing.

This unlocks the ability to use plugins and themes which greatly improve the experience.

## Theme
[Dracula](https://draculatheme.com/) can be used as the theme for both oh my zsh and for terminal.

## Plugins
Unless otherwise indicated these plugins are installed with oh my zsh and just have to be enabled by adding them to your .zshrc.
 + [Git](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/git)
 + [Auto Suggestions](https://github.com/zsh-users/zsh-autosuggestions)
    * [Installation Directions](https://github.com/zsh-users/zsh-autosuggestions/blob/master/INSTALL.md)
 + [Sudo](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/sudo)
 + [Web Search](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/web-search)

# [Homebrew](brew.sh)
This one should be a little obvious but having brew installed makes the commandline experience much better.

Formulae can be found [here](https://formulae.brew.sh/).

## Installation
``
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
``

# Applications
Here is a non exhaustive list of applications that are good to install.

+ Cask: allows you to install applications with brew that have GUI
  + `brew install cask`
+ [Docker](https://www.docker.com/): allows you to perform container operations.
  + `brew cask install docker`
+ Git
  + `brew install git`
+ AWS CLI: Allows you to interact with AWS using the terminal
  + `brew install awscli`
+ [Visual Studio Code](https://code.visualstudio.com/): One of the best lightweight text editors
  + `brew install --cask visual-studio-code`
+ [Speed Test](https://www.speedtest.net/apps/cli): allows an internet speed test to be performed in terminal.
+ [Tmux](https://www.ocf.berkeley.edu/~ckuehl/tmux/): a terminal multiplexer which is very useful for having multiple terminal windows.
  + `brew install tmux`
  + [CheatSheet](https://tmuxcheatsheet.com/)


