package partycast

import (
	"encoding/json"
	"io/ioutil"

	"github.com/markbates/goth"
)

type Config struct {
	Hostname     string `json:"hostname"`
	Port         uint16 `json:"port"`
	Host         string `json:"-"`
	Database     string `json:"database"`
	CookieSecret string `json:"cookie-secret"`
	Auth         map[string]struct {
		Key    string `json:"key"`
		Secret string `json:"secret"`
	} `json:"auth"`
}

func LoadConfig(configPath string) (*Config, error) {
	c := &Config{}
	configBytes, err := ioutil.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(configBytes, c)
	return c, err
}

type ProviderProducer func(string, string, string, ...string) *goth.Provider
