import json
import logging

def load_config(config_path: str) -> dict | None:
    try:
        with open(config_path, 'r') as f:
            config_data = json.load(f)
        
        # Validate basic structure
        if not isinstance(config_data, dict) or "sites" not in config_data:
            logging.error("Invalid configuration format: 'sites' key missing or not a dictionary.")
            return None

        for site_name, site_config in config_data.get("sites", {}).items():
            if not all(key in site_config for key in ["url", "max_pages", "max_depth", "crawl_delay", "data_elements"]):
                logging.error(f"Missing required keys in configuration for site: {site_name}")
                return None
            if not isinstance(site_config["data_elements"], list):
                logging.error(f"data_elements for {site_name} must be a list.")
                return None
            for element in site_config["data_elements"]:
                if not isinstance(element, dict) or not all(key in element for key in ["name", "selector", "type"]):
                    logging.error(f"Invalid data_element format in {site_name}: {element}")
                    return None

        return config_data

    except FileNotFoundError:
        logging.error(f"Configuration file not found: {config_path}")
        return None
    except json.JSONDecodeError:
        logging.error(f"Error decoding JSON from configuration file: {config_path}")
        return None
    except Exception as e:
        logging.error(f"An unexpected error occurred while loading configuration: {e}")
        return None

def get_site_config(site_name: str) -> dict | None:
    # Implementation of get_site_config function
    pass 